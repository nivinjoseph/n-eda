import { ServiceLocator } from "@nivinjoseph/n-ject";
import { EdaEvent } from "../eda-event.js";
import { EdaManager } from "../eda-manager.js";
import { RpcModel } from "../rpc-details.js";
/**
 * Executes events in an HTTP RPC consumer process that were proxied to it by a process running the Redis
 * consume loop.
 *
 * Contract: construct one, hand it to `EdaManager.actAsRpcConsumer(...)`, and register it on an `RpcServer`.
 * The producing side must have called `EdaManager.proxyToRpc(...)`.
 *
 * RULE: a custom RPC endpoint standing in for `RpcServer` must echo `eventName` and `eventId` back exactly —
 * that echo is how `RpcProxyProcessor` detects success. An endpoint that omits them makes every event burn
 * all 10 retries.
 *
 * Note: `EdaContext.topic` is unavailable on this path, and distributed observer events are not dispatched
 * correctly under proxying; see `docs/known-issues.md`.
 */
export declare class RpcEventHandler {
    private readonly _nedaDistributedObserverNotifyEventName;
    private _manager;
    private _logger;
    /**
     * Binds the handler to its manager. Called by `EdaManager.bootstrap()` — never call it yourself.
     *
     * @param manager - the bootstrapping manager
     * @throws if the manager is missing, is not an `EdaManager`, or was not configured with
     * `actAsRpcConsumer`
     */
    initialize(manager: EdaManager): void;
    /**
     * Deserializes a proxied event, resolves its handler in a fresh DI scope, and runs it.
     *
     * Contract: **returns** a failure object rather than throwing, and `RpcServer` sends it with HTTP 200 —
     * the error lives in the body, not the status line.
     *
     * @param model - the proxied request: consumer id, topic, partition, event name, and serialized payload
     * @returns `{ eventName, eventId }` on success, or `{ statusCode, error }` on failure
     */
    process(model: RpcModel): Promise<{
        eventName: string;
        eventId: string;
    } | {
        statusCode: number;
        error: string;
    }>;
    /**
     * Hook invoked after the per-event DI scope is created and before the handler runs.
     *
     * Note: a **no-op** in this class, which is why `EdaContext.topic` throws under RPC proxying. Override it
     * to populate per-event scope state yourself.
     *
     * @param scope - the child scope for this delivery
     * @param topic - the topic that delivered the event
     * @param event - the deserialized event
     */
    protected onEventReceived(scope: ServiceLocator, topic: string, event: EdaEvent): void;
    private _process;
    private _getErrorMessage;
}
//# sourceMappingURL=rpc-event-handler.d.ts.map