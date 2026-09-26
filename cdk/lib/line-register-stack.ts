import * as path from 'path';
import {
  Annotations,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

const LINE_REGISTER_DIR = path.join(__dirname, '..', '..', 'line-register');

export interface LineRegisterStackProps extends StackProps {
  lineChannelSecret: string;
  lineChannelAccessToken: string;
}

export class LineRegisterStack extends Stack {
  constructor(scope: Construct, id: string, props: LineRegisterStackProps) {
    super(scope, id, props);

    if (!props.lineChannelSecret || !props.lineChannelAccessToken) {
      Annotations.of(this).addError(
        'lineChannelSecret and lineChannelAccessToken must be provided ' +
          '(LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN env vars or context).',
      );
    }

    const table = new dynamodb.Table(this, 'LineUsersTable', {
      tableName: 'LINE_Users',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const fn = new nodejs.NodejsFunction(this, 'LineRegisterFunction', {
      entry: path.join(LINE_REGISTER_DIR, 'src', 'index.ts'),
      depsLockFilePath: path.join(LINE_REGISTER_DIR, 'package-lock.json'),
      projectRoot: LINE_REGISTER_DIR,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      functionName: 'tt-line-register',
      timeout: Duration.seconds(60),
      memorySize: 512,
      environment: {
        LINE_CHANNEL_SECRET: props.lineChannelSecret,
        LINE_CHANNEL_ACCESS_TOKEN: props.lineChannelAccessToken,
        LINE_USERS_TABLE_NAME: table.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.CJS,
        target: 'node22',
      },
    });
    table.grantWriteData(fn);

    const url = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    new CfnOutput(this, 'WebhookUrl', { value: url.url });
    new CfnOutput(this, 'FunctionName', { value: fn.functionName });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
