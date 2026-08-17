import { ClassDefinition } from "@nivinjoseph/n-util";
import { EdaEvent } from "./eda-event.js";

/**
 * The contract for a handler in the distributed observer pattern — one that reacts to events from a
 * *specific instance* of a remote entity rather than to an event type at large.
 *
 * RULE: this is an **interface** — `implements` it, never `extends` it.
 *
 * Contract: the implementing class must carry **all three** observer decorators together —
 * `@observedEvent(EventClass)`, `@observable(ObservableClass)`, `@observer(ObserverClass)` — and must not
 * also carry `@event`. `EdaManager.registerEventHandlers` indexes it under the observation key
 * `` `.${observer}.${observable}.${event}` ``, and only one handler may claim a given key.
 *
 * The observable's event must set `refType` to the observable type's name and `refId` to that instance's
 * id, or the consumer's observation-key lookup will miss. Both the observable and observer processes must
 * call `EdaManager.enableDistributedObserver(topic)`.
 *
 * @typeParam TEvent - the observed event type
 *
 * @example
 * ```typescript
 * @observedEvent(OrderShippedEvent)
 * @observable(Order)
 * @observer(Customer)
 * export class CustomerOrderShippedHandler implements ObserverEdaEventHandler<OrderShippedEvent>
 * {
 *     public async handle(event: OrderShippedEvent, observerId: string): Promise<void> { }
 * }
 * ```
 */
// public
export interface ObserverEdaEventHandler<TEvent extends EdaEvent>
{
    /**
     * Processes one observed event.
     *
     * @param event - the inner observed event, already unwrapped from its notification envelope
     * @param observerId - the id of the observer instance that subscribed to this observable
     */
    handle(event: TEvent, observerId: string): Promise<void>;
}

/**
 * A constructable `ObserverEdaEventHandler` type — what the observer decorators are applied to.
 *
 * @typeParam TEvent - the observed event type
 * @typeParam This - the concrete handler type
 */
export type ObserverEdaEventHandlerClass<TEvent extends EdaEvent, This extends ObserverEdaEventHandler<TEvent>> = ClassDefinition<This>;