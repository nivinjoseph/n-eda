import { ClassDefinition } from "@nivinjoseph/n-util";
import { EdaEventHandler } from "./eda-event-handler.js";
import { ObserverEdaEventHandler } from "./observer-eda-event-handler.js";
import { EdaEvent } from "./eda-event.js";
export declare class EventRegistration {
    private readonly _eventHandlerType;
    private readonly _eventHandlerTypeName;
    private readonly _eventType;
    private readonly _eventTypeName;
    private readonly _isObservedEvent;
    private readonly _observableType;
    private readonly _observableTypeName;
    private readonly _observerType;
    private readonly _observerTypeName;
    get eventHandlerType(): ClassDefinition<EdaEventHandler<EdaEvent>> | ClassDefinition<ObserverEdaEventHandler<EdaEvent>>;
    get eventHandlerTypeName(): string;
    get eventType(): ClassDefinition<EdaEvent>;
    get eventTypeName(): string;
    get isObservedEvent(): boolean;
    get observableType(): ClassDefinition<any>;
    get observableTypeName(): string;
    get observerType(): ClassDefinition<any>;
    get observerTypeName(): string;
    get observationKey(): string;
    constructor(eventHandlerType: ClassDefinition<EdaEventHandler<EdaEvent>> | ClassDefinition<ObserverEdaEventHandler<EdaEvent>>);
    static generateObservationKey(observerTypeName: string, observableTypeName: string, observableEventTypeName: string): string;
}
