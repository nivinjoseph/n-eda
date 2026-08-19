import { given } from "@nivinjoseph/n-defensive";
import "@nivinjoseph/n-ext";
/**
 * Metadata key under which `@observedEvent` stores the watched event class.
 *
 * Note: a `Symbol.for` key, so it is identical across duplicate copies of this package.
 */
export const observedEventSymbol = Symbol.for("@nivinjoseph/n-eda/observedEvent");
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
// public
export function observedEvent(eventType) {
    given(eventType, "eventType").ensureHasValue().ensureIsFunction();
    const decorator = function (target, context) {
        given(context, "context")
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            .ensure(t => t.kind === "class", "observedEvent decorator should only be used on a class");
        const className = context.name;
        given(className, className).ensureHasValue().ensureIsString()
            .ensure(_ => typeof target.prototype["handle"] === "function", `class '${className}' should implement 'ObserverEdaEventHandler' interface`);
        context.metadata[observedEventSymbol] = eventType;
    };
    return decorator;
}
/**
 * Metadata key under which `@observable` stores the observable class.
 *
 * Note: a `Symbol.for` key, so it is identical across duplicate copies of this package.
 */
export const observableSymbol = Symbol.for("@nivinjoseph/n-eda/observable");
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
// public
export function observable(type) {
    given(type, "type").ensureHasValue().ensureIsFunction();
    const decorator = function (target, context) {
        given(context, "context")
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            .ensure(t => t.kind === "class", "observable decorator should only be used on a class");
        const className = context.name;
        given(className, className).ensureHasValue().ensureIsString()
            .ensure(_ => typeof target.prototype["handle"] === "function", `class '${className}' should implement 'ObserverEdaEventHandler' interface`);
        context.metadata[observableSymbol] = type;
    };
    return decorator;
}
/**
 * Metadata key under which `@observer` stores the observer class.
 *
 * Note: a `Symbol.for` key, so it is identical across duplicate copies of this package.
 */
export const observerSymbol = Symbol.for("@nivinjoseph/n-eda/observer");
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
// public
export function observer(type) {
    given(type, "type").ensureHasValue().ensureIsFunction();
    const decorator = function (target, context) {
        given(context, "context")
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            .ensure(t => t.kind === "class", "observer decorator should only be used on a class");
        const className = context.name;
        given(className, className).ensureHasValue().ensureIsString()
            .ensure(_ => typeof target.prototype["handle"] === "function", `class '${className}' should implement 'ObserverEdaEventHandler' interface`);
        context.metadata[observerSymbol] = type;
    };
    return decorator;
}
//# sourceMappingURL=observed-event.js.map