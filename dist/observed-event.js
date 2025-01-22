import { given } from "@nivinjoseph/n-defensive";
import "@nivinjoseph/n-ext";
export const observedEventSymbol = Symbol.for("@nivinjoseph/n-eda/observedEvent");
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
export const observableSymbol = Symbol.for("@nivinjoseph/n-eda/observable");
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
export const observerSymbol = Symbol.for("@nivinjoseph/n-eda/observer");
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