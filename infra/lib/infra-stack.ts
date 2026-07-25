import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';

export class InfraStack extends cdk.Stack {
  // Exposed as public properties so later constructs (Lambdas, IAM grants)
  // can reference the tables directly instead of hardcoding names.
  public readonly membersTable: dynamodb.Table;
  public readonly timeSeriesTable: dynamodb.Table;
  public readonly conversationsTable: dynamodb.Table;
  public readonly mlBucket: s3.Bucket;
  public readonly uploadsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---------- Table 1: Members ----------
    // Access pattern: get/put a member profile by ID. Pure key-value.
    this.membersTable = new dynamodb.Table(this, 'MembersTable', {
      tableName: 'recovery-members',
      partitionKey: { name: 'memberId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ---------- Table 2: TimeSeries ----------
    // Readings, check-ins, activities, predictions, simulations.
    // Access pattern: query one member's records by type and date range.
    // SK format: "TYPE#ISO8601", e.g. "CHECKIN#2026-07-24T08:15:00Z"
    this.timeSeriesTable = new dynamodb.Table(this, 'TimeSeriesTable', {
      tableName: 'recovery-timeseries',
      partitionKey: { name: 'memberId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ---------- Table 3: Conversations ----------
    // Bedrock chat messages and versioned plans.
    // SK format: "MSG#ISO8601" or "PLAN#v003"
    this.conversationsTable = new dynamodb.Table(this, 'ConversationsTable', {
      tableName: 'recovery-conversations',
      partitionKey: { name: 'memberId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ---------- S3: ML bucket ----------
    // Synthetic datasets under datasets/, model artefacts under models/.
    // Account ID suffix guarantees global name uniqueness.
    this.mlBucket = new s3.Bucket(this, 'MlBucket', {
      bucketName: `recovery-ml-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ---------- S3: uploads bucket ----------
    this.uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {
      bucketName: `recovery-uploads-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });


    // ---------- Lambda: health check ----------
    const healthFn = new lambda.Function(this, 'HealthFn', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',          // file.function
      code: lambda.Code.fromAsset('../backend/health'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
    });


    // ---------- API Gateway ----------
    const api = new apigateway.RestApi(this, 'RecoveryApi', {
      restApiName: 'recovery-platform-api',
      deployOptions: { stageName: 'dev' },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });



    const health = api.root.addResource('health');
    health.addMethod('GET', new apigateway.LambdaIntegration(healthFn));

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });

    // ---------- Lambda: main API (mocked contracts for now) ----------
    const apiFn = new lambda.Function(this, 'ApiFn', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset('../backend/api'),
      // Headroom for synchronous SageMaker inference (serverless cold start ~1-3s)
      timeout: cdk.Duration.seconds(25),
      memorySize: 256,
      environment: {
        MEMBERS_TABLE: this.membersTable.tableName,
        TIMESERIES_TABLE: this.timeSeriesTable.tableName,
        CONVERSATIONS_TABLE: this.conversationsTable.tableName,
        // Set to Member 4's endpoint name to switch from mock to real
        // predictions — no code change needed.
        SAGEMAKER_ENDPOINT: '',
      },
    });

    this.membersTable.grantReadWriteData(apiFn);
    this.timeSeriesTable.grantReadWriteData(apiFn);
    this.conversationsTable.grantReadWriteData(apiFn);

    // Allow synchronous inference against any endpoint in this account/region
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sagemaker:InvokeEndpoint'],
      resources: [`arn:aws:sagemaker:${this.region}:${this.account}:endpoint/*`],
    }));

    // Catch-all: any path other than /health goes to the API Lambda
    const proxy = api.root.addResource('{proxy+}');
    proxy.addMethod('ANY', new apigateway.LambdaIntegration(apiFn));








    // ---------- Outputs ----------
    // Printed after deploy and visible in CloudFormation; teammates use
    // these names in their code/env vars.
    new cdk.CfnOutput(this, 'MembersTableName', { value: this.membersTable.tableName });
    new cdk.CfnOutput(this, 'TimeSeriesTableName', { value: this.timeSeriesTable.tableName });
    new cdk.CfnOutput(this, 'ConversationsTableName', { value: this.conversationsTable.tableName });
    new cdk.CfnOutput(this, 'MlBucketName', { value: this.mlBucket.bucketName });
    new cdk.CfnOutput(this, 'UploadsBucketName', { value: this.uploadsBucket.bucketName });
  }
}