import "@nivinjoseph/n-ext";
import { ObserverEdaEventHandler, ObserverEdaEventHandlerClass } from "./observer-eda-event-handler.js";
import { EdaEvent, EdaEventClass } from "./eda-event.js";
import { ClassDefinition } from "@nivinjoseph/n-util";
export declare const observedEventSymbol: unique symbol;
export declare function observedEvent<TEvent extends EdaEvent, This extends ObserverEdaEventHandler<TEvent>>(eventType: EdaEventClass<TEvent>): ObserverEventHandlerObservedEventDecorator<TEvent, This>;
export type ObserverEventHandlerObservedEventDecorator<TEvent extends EdaEvent, This extends ObserverEdaEventHandler<TEvent>> = (target: ObserverEdaEventHandlerClass<TEvent, This>, context: ClassDecoratorContext<ObserverEdaEventHandlerClass<TEvent, This>>) => void;
export declare const observableSymbol: unique symbol;
export declare function observable<TEvent extends EdaEvent, This extends ObserverEdaEventHandler<TEvent>>(type: ClassDefinition<any>): ObserverEventHandlerObservableDecorator<TEvent, This>;
export type ObserverEventHandlerObservableDecorator<TEvent extends EdaEvent, This extends ObserverEdaEventHandler<TEvent>> = (target: ObserverEdaEventHandlerClass<TEvent, This>, context: ClassDecoratorContext<ObserverEdaEventHandlerClass<TEvent, This>>) => void;
export declare const observerSymbol: unique symbol;
export declare function observer<TEvent extends EdaEvent, This extends ObserverEdaEventHandler<TEvent>>(type: ClassDefinition<any>): ObserverEventHandlerObserverDecorator<TEvent, This>;
export type ObserverEventHandlerObserverDecorator<TEvent extends EdaEvent, This extends ObserverEdaEventHandler<TEvent>> = (target: ObserverEdaEventHandlerClass<TEvent, This>, context: ClassDecoratorContext<ObserverEdaEventHandlerClass<TEvent, This>>) => void;
//# sourceMappingURL=observed-event.d.ts.map