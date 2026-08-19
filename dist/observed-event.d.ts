import "@nivinjoseph/n-ext";
import { ObserverEdaEventHandler, ObserverEdaEventHandlerClass } from "./observer-eda-event-handler.js";
import { EdaEvent, EdaEventClass } from "./eda-event.js";
import { ClassDefinition } from "@nivinjoseph/n-util";
/**
 * Metadata key under which `@observedEvent` stores the watched event class.
 *
 * Note: a `Symbol.for` key, so it is identical across duplicate copies of this package.
 */
export declare const observedEventSymbol: unique symbol;
/**
 * Declares which event an observer handler watches. One of the three decorators every observer handler
 * needs, alongside {@link observable} and {@link observer}.
 *
 * Contract: a standard (ES2023+) class decorator that writes into `context.metadata`. All three observer
 * decorators must be applied together, and the class must not also carry `@event` — `EventRegistration`
 * rejects a handler with both, or with any of the three missing.
 *
 * @typeParam TEvent - the observed event type
 * @typeParam This - the concrete handler type
 * @param eventType - the event class to watch for on the observable
 * @returns the class decorator
 * @throws if `eventType` is missing or not a function
 * @throws when applied to anything other than a class, or to a class without a `handle` method
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
export declare function observedEvent<TEvent extends EdaEvent, This extends ObserverEdaEventHandler<TEvent>>(eventType: EdaEventClass<TEvent>): ObserverEventHandlerObservedEventDecorator<TEvent, This>;
/**
 * The class decorator returned by {@link observedEvent}.
 *
 * @typeParam TEvent - the observed event type
 * @typeParam This - the concrete handler type
 */
export type ObserverEventHandlerObservedEventDecorator<TEvent extends EdaEvent, This extends ObserverEdaEventHandler<TEvent>> = (target: ObserverEdaEventHandlerClass<TEvent, This>, context: ClassDecoratorContext<ObserverEdaEventHandlerClass<TEvent, This>>) => void;
/**
 * Metadata key under which `@observable` stores the observable class.
 *
 * Note: a `Symbol.for` key, so it is identical across duplicate copies of this package.
 */
export declare const observableSymbol: unique symbol;
/**
 * Declares the type of entity an observer handler watches — the thing that emits the observed event. One of
 * the three decorators every observer handler needs, alongside {@link observedEvent} and {@link observer}.
 *
 * Contract: only the class's **type name** is used, as the middle segment of the observation key
 * `` `.${observer}.${observable}.${event}` ``. The observable's published event must return that same name
 * from its `refType`, or the consumer's lookup will miss and the notification will be dropped.
 *
 * @typeParam TEvent - the observed event type
 * @typeParam This - the concrete handler type
 * @param type - the class of the entity emitting the event
 * @returns the class decorator
 * @throws if `type` is missing or not a function
 * @throws when applied to anything other than a class, or to a class without a `handle` method
 */
export declare function observable<TEvent extends EdaEvent, This extends ObserverEdaEventHandler<TEvent>>(type: ClassDefinition<any>): ObserverEventHandlerObservableDecorator<TEvent, This>;
/**
 * The class decorator returned by {@link observable}.
 *
 * @typeParam TEvent - the observed event type
 * @typeParam This - the concrete handler type
 */
export type ObserverEventHandlerObservableDecorator<TEvent extends EdaEvent, This extends ObserverEdaEventHandler<TEvent>> = (target: ObserverEdaEventHandlerClass<TEvent, This>, context: ClassDecoratorContext<ObserverEdaEventHandlerClass<TEvent, This>>) => void;
/**
 * Metadata key under which `@observer` stores the observer class.
 *
 * Note: a `Symbol.for` key, so it is identical across duplicate copies of this package.
 */
export declare const observerSymbol: unique symbol;
/**
 * Declares the type of entity doing the watching. One of the three decorators every observer handler needs,
 * alongside {@link observedEvent} and {@link observable}.
 *
 * Contract: only the class's **type name** is used, as the first segment of the observation key
 * `` `.${observer}.${observable}.${event}` ``. Pass the same class as the first argument to
 * `EventBus.subscribeToObservables`, or the subscription will not find this handler and will throw.
 *
 * @typeParam TEvent - the observed event type
 * @typeParam This - the concrete handler type
 * @param type - the class of the entity doing the watching
 * @returns the class decorator
 * @throws if `type` is missing or not a function
 * @throws when applied to anything other than a class, or to a class without a `handle` method
 */
export declare function observer<TEvent extends EdaEvent, This extends ObserverEdaEventHandler<TEvent>>(type: ClassDefinition<any>): ObserverEventHandlerObserverDecorator<TEvent, This>;
/**
 * The class decorator returned by {@link observer}.
 *
 * @typeParam TEvent - the observed event type
 * @typeParam This - the concrete handler type
 */
export type ObserverEventHandlerObserverDecorator<TEvent extends EdaEvent, This extends ObserverEdaEventHandler<TEvent>> = (target: ObserverEdaEventHandlerClass<TEvent, This>, context: ClassDecoratorContext<ObserverEdaEventHandlerClass<TEvent, This>>) => void;
//# sourceMappingURL=observed-event.d.ts.map