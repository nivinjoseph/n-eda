import { Deferred, Disposable } from "@nivinjoseph/n-util";
import { RoutedEvent } from "./broker.js";
/**
 * Decides which work item runs on which processor, and when.
 *
 * Contract: implementations must guarantee that at most one work item per `partitionKey` is in flight at any
 * moment — that invariant is where n-eda's ordering guarantee comes from.
 */
export interface Scheduler extends Disposable {
    scheduleWork(routedEvent: RoutedEvent): Promise<void>;
}
/**
 * A `RoutedEvent` paired with the `Deferred` that the consumer awaits — resolved when the handler succeeds,
 * rejected when it exhausts its retries.
 *
 * Note: internal transport type.
 */
export interface WorkItem extends RoutedEvent {
    deferred: Deferred<void>;
}
//# sourceMappingURL=scheduler.d.ts.map