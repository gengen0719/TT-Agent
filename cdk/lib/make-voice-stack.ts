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

    const fn = new lambda.DockerImageFunction(this, 'MakeVoiceFunction', {
      functionName: FUNCTION_NAME,
      code: lambda.DockerImageCode.fromEcr(repository, {
        tagOrDigest: IMAGE_TAG,
      }),
      description: `VOICEVOX text to speech (image asset ${image.imageTag})`,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 3000,
      timeout: Duration.minutes(1),
      environment: { BUCKET_NAME: bucket.bucketName },
      snapStart: lambda.SnapStartConf.ON_PUBLISHED_VERSIONS,
    });
    bucket.grantPut(fn);
    fn.node.addDependency(imagePush);

    const alias = new lambda.Alias(this, 'MakeVoiceAlias', {
      aliasName: 'live',
      version: fn.currentVersion,
    });

    new CfnOutput(this, 'RepositoryUri', { value: repository.repositoryUri });
    new CfnOutput(this, 'BucketName', {
      value: bucket.bucketName,
      exportName: 'TtMakeVoice-BucketName',
    });
    new CfnOutput(this, 'FunctionAliasArn', {
      value: alias.functionArn,
      exportName: 'TtMakeVoice-FunctionAliasArn',
    });
  }
}
