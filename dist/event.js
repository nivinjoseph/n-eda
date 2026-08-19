import { given } from "@nivinjoseph/n-defensive";
import "@nivinjoseph/n-ext";
// import { ArgumentException } from "@nivinjoseph/n-exception";
/**
 * Metadata key under which `@event` stores the handled event class.
 *
 * Note: a `Symbol.for` key, so it is identical across duplicate copies of this package.
 * `src/discovery/event-handler-discovery.ts` re-derives it independently; keep the two in sync.
 */
export const eventSymbol = Symbol.for("@nivinjoseph/n-eda/event");
/**
 * Binds an event handler class to the event type it handles.
 *
 * Contract: a **standard (ES2023+) class decorator** — this package does not use `experimentalDecorators`
 * or `reflect-metadata`. It writes the event class into `context.metadata` under {@link eventSymbol}, which
 * requires `Symbol.metadata` to exist; the package barrel polyfills it at import time, so importing
 * `@nivinjoseph/n-eda` is a prerequisite for the decorator to work at all.
 *
 * RULE: place `@event(...)` **above** `@inject(...)`. The decorated class must implement `EdaEventHandler`
 * (i.e. have a `handle` method), and must not also carry `@observedEvent`.
 *
 * @typeParam TEvent - the event type handled
 * @typeParam This - the concrete handler type
 * @param eventType - the event class this handler processes
 * @returns the class decorator
 * @throws if `eventType` is missing or not a function
 * @throws when applied to anything other than a class, or to a class without a `handle` method
 *
 * @example
 * ```typescript
 * @event(UserCreatedEvent)
 * @inject("Logger")
 * export class UserCreatedEventHandler implements EdaEventHandler<UserCreatedEvent>
 * {
 *     public async handle(event: UserCreatedEvent): Promise<void> { }
 * }
 * ```
 */
// public
export function event(eventType) {
    given(eventType, "eventType").ensureHasValue().ensureIsFunction();
    const decorator = function (target, context) {
        given(context, "context")
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            .ensure(t => t.kind === "class", "event decorator should only be used on a class");
        const className = context.name;
        given(className, className).ensureHasValue().ensureIsString()
            .ensure(_ => typeof target.prototype["handle"] === "function", `class '${className}' should implement 'EdaEventHandler' interface`);
        context.metadata[eventSymbol] = eventType;
    };
    return decorator;
}
//# sourceMappingURL=event.js.map