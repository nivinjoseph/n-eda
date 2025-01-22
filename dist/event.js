import { given } from "@nivinjoseph/n-defensive";
import "@nivinjoseph/n-ext";
// import { ArgumentException } from "@nivinjoseph/n-exception";
export const eventSymbol = Symbol.for("@nivinjoseph/n-eda/event");
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