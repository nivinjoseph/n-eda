import { given } from "@nivinjoseph/n-defensive";
import "@nivinjoseph/n-ext";
import { ObserverEdaEventHandler, ObserverEdaEventHandlerClass } from "./observer-eda-event-handler.js";
import { EdaEvent, EdaEventClass } from "./eda-event.js";
import { ClassDefinition } from "@nivinjoseph/n-util";


export const observedEventSymbol = Symbol.for("@nivinjoseph/n-eda/observedEvent");

// public
export function observedEvent<
    TEvent extends EdaEvent,
    This extends ObserverEdaEventHandler<TEvent>
>(eventType: EdaEventClass<TEvent>): ObserverEventHandlerObservedEventDecorator<TEvent, This>
{
    given(eventType, "eventType").ensureHasValue().ensureIsFunction();

    const decorator: ObserverEventHandlerObservedEventDecorator<TEvent, This> = function (target, context)
    {
        given(context, "context")
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            .ensure(t => t.kind === "class", "observedEvent decorator should only be used on a class");

        const className = context.name!;
        given(className, className).ensureHasValue().ensureIsString()
            .ensure(_ => typeof target.prototype["handle"] === "function", `class '${className}' should implement 'ObserverEdaEventHandler' interface`);

        context.metadata[observedEventSymbol] = eventType;
    };

    return decorator;
}


export type ObserverEventHandlerObservedEventDecorator<TEvent extends EdaEvent, This extends ObserverEdaEventHandler<TEvent>> = (
    target: ObserverEdaEventHandlerClass<TEvent, This>,
    context: ClassDecoratorContext<ObserverEdaEventHandlerClass<TEvent, This>>
) => void;




export const observableSymbol = Symbol.for("@nivinjoseph/n-eda/observable");

// public
export function observable<
    TEvent extends EdaEvent,
    This extends ObserverEdaEventHandler<TEvent>
>(type: ClassDefinition<any>): ObserverEventHandlerObservableDecorator<TEvent, This>
{
    given(type, "type").ensureHasValue().ensureIsFunction();

    const decorator: ObserverEventHandlerObservableDecorator<TEvent, This> = function (target, context)
    {
        given(context, "context")
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            .ensure(t => t.kind === "class", "observable decorator should only be used on a class");

        const className = context.name!;
        given(className, className).ensureHasValue().ensureIsString()
            .ensure(_ => typeof target.prototype["handle"] === "function", `class '${className}' should implement 'ObserverEdaEventHandler' interface`);

        context.metadata[observableSymbol] = type;
    };

    return decorator;
}


export type ObserverEventHandlerObservableDecorator<TEvent extends EdaEvent, This extends ObserverEdaEventHandler<TEvent>> = (
    target: ObserverEdaEventHandlerClass<TEvent, This>,
    context: ClassDecoratorContext<ObserverEdaEventHandlerClass<TEvent, This>>
) => void;




export const observerSymbol = Symbol.for("@nivinjoseph/n-eda/observer");

// public
export function observer<
    TEvent extends EdaEvent,
    This extends ObserverEdaEventHandler<TEvent>
>(type: ClassDefinition<any>): ObserverEventHandlerObserverDecorator<TEvent, This>
{
    given(type, "type").ensureHasValue().ensureIsFunction();

    const decorator: ObserverEventHandlerObserverDecorator<TEvent, This> = function (target, context)
    {
        given(context, "context")
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            .ensure(t => t.kind === "class", "observer decorator should only be used on a class");

        const className = context.name!;
        given(className, className).ensureHasValue().ensureIsString()
            .ensure(_ => typeof target.prototype["handle"] === "function", `class '${className}' should implement 'ObserverEdaEventHandler' interface`);

        context.metadata[observerSymbol] = type;
    };

    return decorator;
}


export type ObserverEventHandlerObserverDecorator<TEvent extends EdaEvent, This extends ObserverEdaEventHandler<TEvent>> = (
    target: ObserverEdaEventHandlerClass<TEvent, This>,
    context: ClassDecoratorContext<ObserverEdaEventHandlerClass<TEvent, This>>
) => void;