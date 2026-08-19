import { ClassDefinition } from "@nivinjoseph/n-util";
import { EdaEvent } from "./eda-event.js";
/**
 * The contract for a handler that processes a single event type.
 *
 * RULE: this is an **interface**, not a base class — `implements` it, never `extends` it.
 *
 * Contract: the implementing class must carry `@event(EventClass)` (placed above any `@inject(...)`) and
 * be passed to `EdaManager.registerEventHandlers(...)`. Handlers are registered **scoped** in the DI
 * container under their own class name, which means a fresh instance per event, that handler class names
 * must be globally unique, and that exactly one handler class may claim a given event type.
 *
 * Note: delivery is at-least-once with a dedupe window of only the last 1000 event ids per
 * (topic, partition, consumer group) — **handlers must be idempotent**. A throw is retried 10 times over
 * roughly 8.5 minutes, after which the event is logged and dropped; there is no dead-letter queue.
 *
 * @typeParam TEvent - the event type this handler processes
 *
 * @example
 * ```typescript
 * @event(UserCreatedEvent)
 * @inject("Logger")
 * export class UserCreatedEventHandler implements EdaEventHandler<UserCreatedEvent>
 * {
 *     public constructor(private readonly _logger: Logger) { }
 *
 *     public async handle(event: UserCreatedEvent): Promise<void>
 *     {
 *         await this._logger.logInfo(event.id);
 *     }
 * }
 * ```
 */
export interface EdaEventHandler<TEvent extends EdaEvent> {
    /**
     * Processes one event. Resolving marks the event handled; throwing triggers the retry ladder.
     *
     * Note: the event object carries a `$scope` property holding the DI child scope for this delivery,
     * and that scope is disposed as soon as this method returns. Do not retain the event past `handle`.
     *
     * @param event - the deserialized event
     */
    handle(event: TEvent): Promise<void>;
}
/**
 * A constructable `EdaEventHandler` type — what `registerEventHandlers` and the `@event` decorator accept.
 *
 * @typeParam TEvent - the event type handled
 * @typeParam TEventHandler - the concrete handler type
 */
export type EventHandlerClass<TEvent extends EdaEvent, TEventHandler extends EdaEventHandler<TEvent>> = ClassDefinition<TEventHandler>;
//# sourceMappingURL=eda-event-handler.d.ts.map