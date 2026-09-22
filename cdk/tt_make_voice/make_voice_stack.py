from pathlib import Path

import cdk_ecr_deployment as ecr_deployment
from aws_cdk import (
    CfnOutput,
    Duration,
    RemovalPolicy,
    Stack,
    aws_ecr as ecr,
    aws_ecr_assets as ecr_assets,
    aws_lambda as lambda_,
    aws_s3 as s3,
    custom_resources as cr,
)
from constructs import Construct

REPOSITORY_NAME = "voicevox-image"
IMAGE_TAG = "latest"
FUNCTION_NAME = "tt-make-voice"
MAKE_VOICE_DIR = Path(__file__).resolve().parents[2] / "make-voice"


class MakeVoiceStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        bucket = s3.Bucket(
            self,
            "VoiceOutputBucket",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            access_control=s3.BucketAccessControl.PRIVATE,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,
            versioned=False,
            lifecycle_rules=[
                s3.LifecycleRule(
                    expiration=Duration.days(1),
                    abort_incomplete_multipart_upload_after=Duration.days(1),
                )
            ],
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
        )

        repository = ecr.Repository(
            self,
            "VoicevoxImageRepository",
            repository_name=REPOSITORY_NAME,
            image_tag_mutability=ecr.TagMutability.MUTABLE,
            image_scan_on_push=True,
            removal_policy=RemovalPolicy.RETAIN,
            lifecycle_rules=[
                ecr.LifecycleRule(
                    rule_priority=1,
                    description="Delete the previous image 3 days after it was pushed",
                    tag_status=ecr.TagStatus.UNTAGGED,
                    max_image_age=Duration.days(3),
                ),
                ecr.LifecycleRule(
                    rule_priority=2,
                    description="Keep only the previous image, delete anything older",
                    tag_status=ecr.TagStatus.UNTAGGED,
                    max_image_count=1,
                ),
            ],
        )

        image = ecr_assets.DockerImageAsset(
            self,
            "VoicevoxImageAsset",
            directory=str(MAKE_VOICE_DIR),
            platform=ecr_assets.Platform.LINUX_ARM64,
        )

        image_push = ecr_deployment.ECRDeployment(
            self,
            "VoicevoxImagePush",
            src=ecr_deployment.DockerImageName(image.image_uri),
            dest=ecr_deployment.DockerImageName(
                f"{repository.repository_uri}:{IMAGE_TAG}"
            ),
        )

        image_digest_lookup = cr.AwsCustomResource(
            self,
            "VoicevoxImageDigest",
            on_update=cr.AwsSdkCall(
                service="ECR",
                action="describeImages",
                parameters={
                    "repositoryName": repository.repository_name,
                    "imageIds": [{"imageTag": IMAGE_TAG}],
                },
                physical_resource_id=cr.PhysicalResourceId.of(image.image_tag),
                output_paths=["imageDetails.0.imageDigest"],
            ),
            policy=cr.AwsCustomResourcePolicy.from_sdk_calls(
                resources=[repository.repository_arn]
            ),
            install_latest_aws_sdk=False,
        )
        image_digest_lookup.node.add_dependency(image_push)

        function = lambda_.DockerImageFunction(
            self,
            "MakeVoiceFunction",
            function_name=FUNCTION_NAME,
            code=lambda_.DockerImageCode.from_ecr(
                repository,
                tag_or_digest=image_digest_lookup.get_response_field(
                    "imageDetails.0.imageDigest"
                ),
            ),
            description=f"VOICEVOX text to speech (image asset {image.image_tag})",
            architecture=lambda_.Architecture.ARM_64,
            memory_size=4096,
            timeout=Duration.minutes(1),
            environment={"BUCKET_NAME": bucket.bucket_name},
            snap_start=lambda_.SnapStartConf.ON_PUBLISHED_VERSIONS,
        )
        bucket.grant_put(function)

        alias = lambda_.Alias(
            self,
            "MakeVoiceAlias",
            alias_name="live",
            version=function.current_version,
        )

        CfnOutput(self, "RepositoryUri", value=repository.repository_uri)
        CfnOutput(self, "BucketName", value=bucket.bucket_name)
        CfnOutput(self, "FunctionAliasArn", value=alias.function_arn)
