import { given } from "@nivinjoseph/n-defensive";
import { ClassDefinition } from "@nivinjoseph/n-util";
import { EdaEventHandler } from "./eda-event-handler.js";
import { eventSymbol } from "./event.js";
import { observableSymbol, observedEventSymbol, observerSymbol } from "./observed-event.js";
import { ObserverEdaEventHandler } from "./observer-eda-event-handler.js";
import { EdaEvent } from "./eda-event.js";

// public
export class EventRegistration
{
    private readonly _eventHandlerType: ClassDefinition<EdaEventHandler<EdaEvent> | ObserverEdaEventHandler<EdaEvent>>;
    private readonly _eventHandlerTypeName: string;
    private readonly _eventType: ClassDefinition<EdaEvent>;
    private readonly _eventTypeName: string;

    private readonly _isObservedEvent: boolean = false;
    private readonly _observableType: ClassDefinition<any> | null = null;
    private readonly _observableTypeName: string | null = null;
    private readonly _observerType: ClassDefinition<any> | null = null;
    private readonly _observerTypeName: string | null = null;


    public get eventHandlerType(): ClassDefinition<EdaEventHandler<EdaEvent> | ObserverEdaEventHandler<EdaEvent>> { return this._eventHandlerType; }
    public get eventHandlerTypeName(): string { return this._eventHandlerTypeName; }
    public get eventType(): ClassDefinition<EdaEvent> { return this._eventType; }
    public get eventTypeName(): string { return this._eventTypeName; }

    public get isObservedEvent(): boolean { return this._isObservedEvent; }
    public get observableType(): ClassDefinition<any>
    {
        given(this, "this").ensure(t => t._isObservedEvent, "not observed event");
        return this._observableType!;
    }
    public get observableTypeName(): string
    {
        given(this, "this").ensure(t => t._isObservedEvent, "not observed event");
        return this._observableTypeName!;
    }
    public get observerType(): ClassDefinition<any>
    {
        given(this, "this").ensure(t => t._isObservedEvent, "not observed event");
        return this._observerType!;
    }
    public get observerTypeName(): string
    {
        given(this, "this").ensure(t => t._isObservedEvent, "not observed event");
        return this._observerTypeName!;
    }
    public get observationKey(): string
    {
        return EventRegistration.generateObservationKey(this.observerTypeName,
            this.observableTypeName, this.eventTypeName);
    }


    public constructor(eventHandlerType: ClassDefinition<EdaEventHandler<EdaEvent> | ObserverEdaEventHandler<EdaEvent>>)
    {
        const eventHandlerName = eventHandlerType.getTypeName();
        given(eventHandlerType, "eventHandlerType").ensureHasValue().ensureIsFunction()
            .ensure(t => t[Symbol.metadata] != null, `EventHandler '${eventHandlerName}' has no decorators applied to it`)
            .ensure(
                t => t[Symbol.metadata]![eventSymbol] != null || t[Symbol.metadata]![observedEventSymbol] != null,
                `EventHandler '${eventHandlerName}' does not have event or observedEvent decorators applied.`
            )
            .ensure(
                t => t[Symbol.metadata]![eventSymbol] == null || t[Symbol.metadata]![observedEventSymbol] == null,
                `EventHandler '${eventHandlerName}' has both event or observedEvent decorators applied.`
            );

        this._eventHandlerType = eventHandlerType;
        this._eventHandlerTypeName = eventHandlerName;

        const metadata = eventHandlerType[Symbol.metadata]!;

        if (metadata[eventSymbol] != null)
        {
            this._eventType = metadata[eventSymbol] as ClassDefinition<EdaEvent>;
        }
        else // observedEvent
        {
            this._eventType = metadata[observedEventSymbol] as ClassDefinition<EdaEvent>;
            this._isObservedEvent = true;

            given(eventHandlerType, "eventHandlerType").ensureHasValue().ensureIsFunction()
                .ensure(_ => metadata[observableSymbol] != null,
                    `EventHandler '${eventHandlerName}' does not have observable decorator applied.`)
                .ensure(_ => metadata[observerSymbol] != null,
                    `EventHandler '${eventHandlerName}' does not have observer decorator applied.`)
                ;

            this._observableType = metadata[observableSymbol] as ClassDefinition<any>;
            this._observableTypeName = this._observableType.getTypeName();

            this._observerType = metadata[observerSymbol] as ClassDefinition<any>;
            this._observerTypeName = this._observerType.getTypeName();
        }

        this._eventTypeName = this._eventType.getTypeName();



        // let eventTypeName: string = Reflect.getOwnMetadata(eventSymbol, this._eventHandlerType);
        // eventTypeName = eventTypeName.trim();

        // if (eventTypeName.endsWith("*"))
        // {
        //     eventTypeName = eventTypeName.substr(0, eventTypeName.length - 1);
        //     this._isWild = true;
        // }
        // else
        // {
        //     this._isWild = false;
        // }

        // this._eventTypeName = eventTypeName.trim();
    }

    public static generateObservationKey(observerTypeName: string, observableTypeName: string, observableEventTypeName: string): string
    {
        given(observerTypeName, "observerTypeName").ensureHasValue().ensureIsString();
        given(observableTypeName, "observableTypeName").ensureHasValue().ensureIsString();
        given(observableEventTypeName, "observableEventTypeName").ensureHasValue().ensureIsString();

        return `.${observerTypeName}.${observableTypeName}.${observableEventTypeName}`;
    }
}