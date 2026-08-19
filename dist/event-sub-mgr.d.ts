import { Disposable } from "@nivinjoseph/n-util";
import { EdaManager } from "./eda-manager.js";
/**
 * The consuming half of n-eda: owns the read loop that pulls events off the log and dispatches them to
 * handlers. `RedisEventSubMgr` is the only shipped implementation.
 *
 * Contract: register the class (not an instance) with
 * `EdaManager.registerEventSubscriptionManager(RedisEventSubMgr, consumerGroupId)` so the container can
 * inject its dependencies. The `consumerGroupId` scopes the read offset — distinct ids each get an
 * independent copy of the stream; processes sharing an id share one offset.
 *
 * Note: registering an `EventSubMgr` is mutually exclusive with acting as an AWS Lambda or RPC consumer;
 * `EdaManager.bootstrap` enforces that.
 */
export interface EventSubMgr extends Disposable {
    /**
     * Wires this subscription manager to its manager. Called by `EdaManager.bootstrap()` — never call it
     * yourself.
     *
     * @param manager - the bootstrapping manager
     * @throws if already initialized, or if the manager has been disposed
     */
    initialize(manager: EdaManager): void;
    /**
     * Starts consuming. Creates one consumer per owned partition of every subscribed topic.
     *
     * RULE: the returned promise **does not resolve** until `dispose()` — this is a long-running loop, not
     * a startup step. Never `await` it in a bootstrap path; it will hang the process.
     *
     * @throws if not initialized
     */
    consume(): Promise<void>;
}
//# sourceMappingURL=event-sub-mgr.d.ts.map