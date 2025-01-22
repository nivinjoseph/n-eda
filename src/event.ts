import { given } from "@nivinjoseph/n-defensive";
import "@nivinjoseph/n-ext";
import { EdaEventHandler, EventHandlerClass } from "./eda-event-handler.js";
import { EdaEvent, EdaEventClass } from "./eda-event.js";
// import { ArgumentException } from "@nivinjoseph/n-exception";


export const eventSymbol = Symbol.for("@nivinjoseph/n-eda/event");

// public
export function event<TEvent extends EdaEvent, This extends EdaEventHandler<TEvent>>(eventType: EdaEventClass<TEvent>): EventHandlerEventDecorator<TEvent, This>
{
    given(eventType, "eventType").ensureHasValue().ensureIsFunction();

    const decorator: EventHandlerEventDecorator<TEvent, This> = function (target, context)
    {
        given(context, "context")
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            .ensure(t => t.kind === "class", "event decorator should only be used on a class");

        const className = context.name!;
        given(className, className).ensureHasValue().ensureIsString()
            .ensure(_ => typeof target.prototype["handle"] === "function", `class '${className}' should implement 'EdaEventHandler' interface`);
        
        context.metadata[eventSymbol] = eventType;
    };

    return decorator;
}

export type EventHandlerEventDecorator<TEvent extends EdaEvent, This extends EdaEventHandler<TEvent>> = (
    target: EventHandlerClass<TEvent, This>,
    context: ClassDecoratorContext<EventHandlerClass<TEvent, This>>
) => void;