import * as path from 'path';
import {
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_apigatewayv2 as apigatewayv2,
  aws_apigatewayv2_integrations as apigatewayv2Integrations,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

const LINE_ECHO_DIR = path.join(__dirname, '..', '..', 'line-echo');

export interface LineEchoStackProps extends StackProps {
}

const LINE_CREDENTIAL_PLACEHOLDER = 'REPLACE_IN_LAMBDA_CONSOLE';

export class LineEchoStack extends Stack {
  constructor(scope: Construct, id: string, props: LineEchoStackProps) {
    super(scope, id, props);

    const lineUsersTable = new dynamodb.Table(this, 'TtLineEchoUsersTable', {
      tableName: 'TtLineEchoUsersTable',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const makeVoiceFunctionArn = Fn.importValue('TtMakeVoice-FunctionAliasArn');
    const voiceBucketName = Fn.importValue('TtMakeVoice-BucketName');

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
        LINE_CHANNEL_SECRET: LINE_CREDENTIAL_PLACEHOLDER,
        LINE_CHANNEL_ACCESS_TOKEN: LINE_CREDENTIAL_PLACEHOLDER,
        MAKE_VOICE_FUNCTION_ARN: makeVoiceFunctionArn,
        VOICE_BUCKET_NAME: voiceBucketName,
        LINE_USERS_TABLE_NAME: lineUsersTable.tableName,
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
    lineUsersTable.grantWriteData(fn);
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`arn:aws:s3:::${voiceBucketName}/*`],
      }),
    );

    const api = new apigatewayv2.HttpApi(this, 'LineEchoApi', {
      apiName: 'tt-line-echo',
      defaultIntegration: new apigatewayv2Integrations.HttpLambdaIntegration(
        'LineEchoIntegration',
        fn,
      ),
    });

    new CfnOutput(this, 'WebhookUrl', { value: api.url! });
    new CfnOutput(this, 'FunctionName', { value: fn.functionName });
    new CfnOutput(this, 'TableName', { value: lineUsersTable.tableName });
  }
}
