import { ServiceLocator } from "@nivinjoseph/n-ject";
import { EdaEvent } from "../eda-event.js";
import { EdaManager } from "../eda-manager.js";
import { GrpcModel } from "../grpc-details.js";
/**
 * Executes events in a gRPC consumer process that were proxied to it by a process running the Redis consume
 * loop.
 *
 * Contract: construct one, hand it to `EdaManager.actAsGrpcConsumer(...)`, and register it on a
 * `GrpcServer`. The producing side must have called `EdaManager.proxyToGrpc(...)`. The `.proto` definitions
 * ship with this package.
 *
 * Note: unlike the Lambda and RPC handlers, {@link GrpcEventHandler.process} **throws** on failure rather
 * than returning an error object. `EdaContext.topic` is unavailable on this path, and distributed observer
 * events are not dispatched correctly under proxying; see `docs/known-issues.md`.
 */
export declare class GrpcEventHandler {
    private readonly _nedaDistributedObserverNotifyEventName;
    private _manager;
    private _logger;
    /**
     * Binds the handler to its manager. Called by `EdaManager.bootstrap()` — never call it yourself.
     *
     * @param manager - the bootstrapping manager
     * @throws if the manager is missing, is not an `EdaManager`, or was not configured with
     * `actAsGrpcConsumer`
     */
    initialize(manager: EdaManager): void;
    /**
     * Deserializes a proxied event, resolves its handler in a fresh DI scope, and runs it.
     *
     * Contract: **throws** on failure, unlike `AwsLambdaEventHandler.process` and `RpcEventHandler.process`,
     * which return `{ statusCode, error }`. The gRPC layer turns the throw into a call error.
     *
     * @param model - the proxied request; `payload` is a JSON **string** here, not an object
     * @returns `{ eventName, eventId }` echoing the processed event
     * @throws `Error` if the event cannot be deserialized or its handler fails
     */
    process(model: GrpcModel): Promise<{
        eventName: string;
        eventId: string;
    }>;
    /**
     * Hook invoked after the per-event DI scope is created and before the handler runs.
     *
     * Note: a **no-op** in this class, which is why `EdaContext.topic` throws under gRPC proxying. Override
     * it to populate per-event scope state yourself.
     *
     * @param scope - the child scope for this delivery
     * @param topic - the topic that delivered the event
     * @param event - the deserialized event
     */
    protected onEventReceived(scope: ServiceLocator, topic: string, event: EdaEvent): void;
    private _process;
    private _getErrorMessage;
}
//# sourceMappingURL=grpc-event-handler.d.ts.map