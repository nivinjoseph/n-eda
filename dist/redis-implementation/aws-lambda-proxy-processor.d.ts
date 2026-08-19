import { EdaManager } from "../eda-manager.js";
import { Processor } from "./processor.js";
import { WorkItem } from "./scheduler.js";
/**
 * Forwards each work item to an AWS Lambda function instead of running a handler locally.
 *
 * Contract: success is confirmed by the Lambda echoing back the event's `eventName` and `eventId`; anything
 * else is treated as a failure and feeds the retry ladder.
 *
 * Note: an empty Lambda response currently raises a `TypeError` rather than a useful diagnostic. See
 * `docs/known-issues.md`.
 */
export declare class AwsLambdaProxyProcessor extends Processor {
    private readonly _lambda;
    constructor(manager: EdaManager);
    protected processEvent(workItem: WorkItem): Promise<void>;
    private _invokeLambda;
}
//# sourceMappingURL=aws-lambda-proxy-processor.d.ts.map