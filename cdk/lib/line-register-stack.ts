import {
  CfnOutput,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_dynamodb as dynamodb,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class LineRegisterStack extends Stack {
  readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    this.table = new dynamodb.Table(this, 'LineUsersTable', {
      tableName: 'LINE_Users',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    new CfnOutput(this, 'TableName', { value: this.table.tableName });
  }
}
