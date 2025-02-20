import "@nivinjoseph/n-ext";
import { EdaEventHandler, EventHandlerClass } from "./eda-event-handler.js";
import { EdaEvent, EdaEventClass } from "./eda-event.js";
export declare const eventSymbol: unique symbol;
export declare function event<TEvent extends EdaEvent, This extends EdaEventHandler<TEvent>>(eventType: EdaEventClass<TEvent>): EventHandlerEventDecorator<TEvent, This>;
export type EventHandlerEventDecorator<TEvent extends EdaEvent, This extends EdaEventHandler<TEvent>> = (target: EventHandlerClass<TEvent, This>, context: ClassDecoratorContext<EventHandlerClass<TEvent, This>>) => void;
//# sourceMappingURL=event.d.ts.map