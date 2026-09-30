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
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

const LINE_CHAT_DIR = path.join(__dirname, '..', '..', 'line-chat');
const LINE_CREDENTIAL_PLACEHOLDER = 'REPLACE_IN_LAMBDA_CONSOLE';

export interface LineChatStackProps extends StackProps {}

export class LineChatStack extends Stack {
  constructor(scope: Construct, id: string, props: LineChatStackProps) {
    super(scope, id, props);

    const lineUsersTable = new dynamodb.Table(this, 'LineUsersTable', {
      tableName: 'TtAgentLineUsers',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const makeVoiceFunctionArn = Fn.importValue('TtMakeVoice-FunctionAliasArn');
    const voiceBucketName = Fn.importValue('TtMakeVoice-BucketName');

    const fn = new lambda.Function(this, 'LineChatFunction', {
      code: lambda.Code.fromAsset(LINE_CHAT_DIR, {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash',
            '-c',
            'pip install --no-cache-dir -r requirements.txt -t /asset-output && cp -au . /asset-output',
          ],
        },
      }),
      handler: 'lambda_function.handler',
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      functionName: 'tt-line-chat',
      timeout: Duration.seconds(60),
      memorySize: 1024,
      environment: {
        LINE_CHANNEL_SECRET: LINE_CREDENTIAL_PLACEHOLDER,
        LINE_CHANNEL_ACCESS_TOKEN: LINE_CREDENTIAL_PLACEHOLDER,
        LINE_USERS_TABLE_NAME: lineUsersTable.tableName,
        MAKE_VOICE_FUNCTION_ARN: makeVoiceFunctionArn,
        VOICE_BUCKET_NAME: voiceBucketName,
        BEDROCK_MODEL_ID: 'amazon.nova-micro-v1:0',
      },
    });

    lineUsersTable.grantWriteData(fn);
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
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/*`],
      }),
    );

    const api = new apigatewayv2.HttpApi(this, 'LineChatApi', {
      apiName: 'tt-line-chat',
      defaultIntegration: new apigatewayv2Integrations.HttpLambdaIntegration(
        'LineChatIntegration',
        fn,
      ),
    });

    new CfnOutput(this, 'WebhookUrl', { value: api.url! });
    new CfnOutput(this, 'FunctionName', { value: fn.functionName });
    new CfnOutput(this, 'TableName', { value: lineUsersTable.tableName });
  }
}