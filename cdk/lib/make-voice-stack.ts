import * as path from 'path';
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_ecr as ecr,
  aws_ecr_assets as ecrAssets,
  aws_lambda as lambda,
  aws_s3 as s3,
  custom_resources as cr,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DockerImageName, ECRDeployment } from 'cdk-ecr-deployment';

const REPOSITORY_NAME = 'voicevox-image';
const IMAGE_TAG = 'latest';
const FUNCTION_NAME = 'tt-make-voice';
const MAKE_VOICE_DIR = path.join(__dirname, '..', '..', 'make-voice');

export class MakeVoiceStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'VoiceOutputBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      accessControl: s3.BucketAccessControl.PRIVATE,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      lifecycleRules: [
        {
          expiration: Duration.days(1),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const repository = new ecr.Repository(this, 'VoicevoxImageRepository', {
      repositoryName: REPOSITORY_NAME,
      imageTagMutability: ecr.TagMutability.MUTABLE,
      imageScanOnPush: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          rulePriority: 1,
          description: 'Delete the previous image 3 days after it was pushed',
          tagStatus: ecr.TagStatus.UNTAGGED,
          maxImageAge: Duration.days(3),
        },
        {
          rulePriority: 2,
          description: 'Keep only the previous image, delete anything older',
          tagStatus: ecr.TagStatus.UNTAGGED,
          maxImageCount: 1,
        },
      ],
    });

    const image = new ecrAssets.DockerImageAsset(this, 'VoicevoxImageAsset', {
      directory: MAKE_VOICE_DIR,
      platform: ecrAssets.Platform.LINUX_ARM64,
    });

    const imagePush = new ECRDeployment(this, 'VoicevoxImagePush', {
      src: new DockerImageName(image.imageUri),
      dest: new DockerImageName(`${repository.repositoryUri}:${IMAGE_TAG}`),
    });

    const imageDigestLookup = new cr.AwsCustomResource(this, 'VoicevoxImageDigest', {
      onUpdate: {
        service: 'ECR',
        action: 'describeImages',
        parameters: {
          repositoryName: repository.repositoryName,
          imageIds: [{ imageTag: IMAGE_TAG }],
        },
        physicalResourceId: cr.PhysicalResourceId.of(image.imageTag),
        outputPaths: ['imageDetails.0.imageDigest'],
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [repository.repositoryArn],
      }),
      installLatestAwsSdk: false,
    });
    imageDigestLookup.node.addDependency(imagePush);

    const fn = new lambda.DockerImageFunction(this, 'MakeVoiceFunction', {
      functionName: FUNCTION_NAME,
      code: lambda.DockerImageCode.fromEcr(repository, {
        tagOrDigest: imageDigestLookup.getResponseField('imageDetails.0.imageDigest'),
      }),
      description: `VOICEVOX text to speech (image asset ${image.imageTag})`,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 4096,
      timeout: Duration.minutes(1),
      environment: { BUCKET_NAME: bucket.bucketName },
      snapStart: lambda.SnapStartConf.ON_PUBLISHED_VERSIONS,
    });
    bucket.grantPut(fn);

    const alias = new lambda.Alias(this, 'MakeVoiceAlias', {
      aliasName: 'live',
      version: fn.currentVersion,
    });

    new CfnOutput(this, 'RepositoryUri', { value: repository.repositoryUri });
    new CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new CfnOutput(this, 'FunctionAliasArn', { value: alias.functionArn });
  }
}
