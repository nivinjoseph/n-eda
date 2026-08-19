import { ServiceLocator } from "@nivinjoseph/n-ject";
import { EdaEvent } from "../eda-event.js";
import { EdaManager } from "../eda-manager.js";
/**
 * Executes events inside an AWS Lambda that were proxied to it by a process running the Redis consume loop.
 *
 * Contract: construct one in the Lambda, hand it to `EdaManager.actAsAwsLambdaConsumer(...)`, and delegate
 * the Lambda entry point to {@link AwsLambdaEventHandler.process}. The producing side must have called
 * `EdaManager.proxyToAwsLambda(...)`.
 *
 * Note: `EdaContext.topic` is unavailable on this path — {@link AwsLambdaEventHandler.onEventReceived} is a
 * no-op here. Distributed observer events are also not dispatched correctly under proxying; see
 * `docs/known-issues.md`.
 */
export declare class AwsLambdaEventHandler {
    private readonly _nedaDistributedObserverNotifyEventName;
    private _manager;
    private _logger;
    /**
     * Binds the handler to its manager. Called by `EdaManager.bootstrap()` — never call it yourself.
     *
     * @param manager - the bootstrapping manager
     * @throws if the manager is missing, is not an `EdaManager`, or was not configured with
     * `actAsAwsLambdaConsumer`
     */
    initialize(manager: EdaManager): void;
    /**
     * Deserializes a proxied event, resolves its handler in a fresh DI scope, and runs it.
     *
     * Contract: **returns** a failure object rather than throwing — `{ statusCode, error }`. Contrast
     * `GrpcEventHandler.process`, which throws. The success shape echoes `eventName` and `eventId`, which the
     * proxying side uses to confirm the event was handled.
     *
     * @param event - the proxied payload: consumer id, topic, partition, event name, and serialized event
     * @param context - the Lambda invocation context
     * @returns `{ eventName, eventId }` on success, or `{ statusCode, error }` on failure
     */
    process(event: object, context: Record<string, any>): Promise<{
        eventName: string;
        eventId: string;
    } | {
        statusCode: number;
        error: string;
    }>;
    /**
     * Hook invoked after the per-event DI scope is created and before the handler runs.
     *
     * Note: a **no-op** in this class, unlike `RedisEventSubMgr`'s override — which is why `EdaContext.topic`
     * throws under Lambda proxying. Override it to populate per-event scope state yourself.
     *
     * @param scope - the child scope for this delivery
     * @param topic - the topic that delivered the event
     * @param event - the deserialized event
     */
    protected onEventReceived(scope: ServiceLocator, topic: string, event: EdaEvent): void;
    private _process;
    private _getErrorMessage;
}
//# sourceMappingURL=aws-lambda-event-handler.d.ts.map