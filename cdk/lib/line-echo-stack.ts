import * as path from 'path';
import {
  Annotations,
  CfnOutput,
  Duration,
  Fn,
  Stack,
  StackProps,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

const LINE_ECHO_DIR = path.join(__dirname, '..', '..', 'line-echo');

export interface LineEchoStackProps extends StackProps {
  lineChannelSecret: string;
  lineChannelAccessToken: string;
}

export class LineEchoStack extends Stack {
  constructor(scope: Construct, id: string, props: LineEchoStackProps) {
    super(scope, id, props);

    const makeVoiceFunctionArn = Fn.importValue('TtMakeVoice-FunctionAliasArn');
    const voiceBucketName = Fn.importValue('TtMakeVoice-BucketName');

    if (!props.lineChannelSecret || !props.lineChannelAccessToken) {
      Annotations.of(this).addError(
        'lineChannelSecret and lineChannelAccessToken must be provided ' +
          '(LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN env vars or context).',
      );
    }

    const fn = new nodejs.NodejsFunction(this, 'LineEchoFunction', {
      entry: path.join(LINE_ECHO_DIR, 'src', 'index.ts'),
      depsLockFilePath: path.join(LINE_ECHO_DIR, 'package-lock.json'),
      projectRoot: LINE_ECHO_DIR,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      functionName: 'tt-line-echo',
      timeout: Duration.seconds(60),
      memorySize: 512,
      environment: {
        LINE_CHANNEL_SECRET: props.lineChannelSecret,
        LINE_CHANNEL_ACCESS_TOKEN: props.lineChannelAccessToken,
        MAKE_VOICE_FUNCTION_ARN: makeVoiceFunctionArn,
        VOICE_BUCKET_NAME: voiceBucketName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.CJS,
        target: 'node22',
      },
    });

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [makeVoiceFunctionArn],
      }),
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`arn:aws:s3:::${voiceBucketName}/*`],
      }),
    );

    const url = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    new CfnOutput(this, 'WebhookUrl', { value: url.url });
    new CfnOutput(this, 'FunctionName', { value: fn.functionName });
  }
}
