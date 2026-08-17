/**
 * Connection details for proxying event processing to an AWS Lambda function.
 *
 * Contract: pass to `EdaManager.proxyToAwsLambda(...)` on the process that runs the Redis consume loop.
 * The Lambda itself is the executing side and must call `EdaManager.actAsAwsLambdaConsumer(...)` with an
 * `AwsLambdaEventHandler`.
 *
 * Note: unlike `GrpcDetails`, every field here is required — including `credentials`.
 */
export interface LambdaDetails
{
    /** AWS region the function is deployed in, e.g. `"us-east-1"`. */
    readonly region: string;

    /** The Lambda function name (not an ARN, not a `functionName` alias). */
    readonly funcName: string;

    /**
     * IAM credentials used to invoke the function. Required.
     *
     * Note: the repo ships a `config.json` with empty `awsLambdaAccessKeyId` / `awsLambdaSecretAccessKey`
     * keys, intended to be read via `@nivinjoseph/n-config` rather than hardcoded.
     */
    credentials: {
        readonly accessKeyId: string;
        readonly accessKeySecret: string;
    };
}
