import { given } from "@nivinjoseph/n-defensive";
import { eventSymbol } from "./event.js";
import { observableSymbol, observedEventSymbol, observerSymbol } from "./observed-event.js";
// public
export class EventRegistration {
    get eventHandlerType() { return this._eventHandlerType; }
    get eventHandlerTypeName() { return this._eventHandlerTypeName; }
    get eventType() { return this._eventType; }
    get eventTypeName() { return this._eventTypeName; }
    get isObservedEvent() { return this._isObservedEvent; }
    get observableType() {
        given(this, "this").ensure(t => t._isObservedEvent, "not observed event");
        return this._observableType;
    }
    get observableTypeName() {
        given(this, "this").ensure(t => t._isObservedEvent, "not observed event");
        return this._observableTypeName;
    }
    get observerType() {
        given(this, "this").ensure(t => t._isObservedEvent, "not observed event");
        return this._observerType;
    }
    get observerTypeName() {
        given(this, "this").ensure(t => t._isObservedEvent, "not observed event");
        return this._observerTypeName;
    }
    get observationKey() {
        return EventRegistration.generateObservationKey(this.observerTypeName, this.observableTypeName, this.eventTypeName);
    }
    constructor(eventHandlerType) {
        this._isObservedEvent = false;
        this._observableType = null;
        this._observableTypeName = null;
        this._observerType = null;
        this._observerTypeName = null;
        const eventHandlerName = eventHandlerType.getTypeName();
        given(eventHandlerType, "eventHandlerType").ensureHasValue().ensureIsFunction()
            .ensure(t => t[Symbol.metadata] != null, `EventHandler '${eventHandlerName}' has no decorators applied to it`)
            .ensure(t => t[Symbol.metadata][eventSymbol] != null || t[Symbol.metadata][observedEventSymbol] != null, `EventHandler '${eventHandlerName}' does not have event or observedEvent decorators applied.`)
            .ensure(t => t[Symbol.metadata][eventSymbol] == null || t[Symbol.metadata][observedEventSymbol] == null, `EventHandler '${eventHandlerName}' has both event or observedEvent decorators applied.`);
        this._eventHandlerType = eventHandlerType;
        this._eventHandlerTypeName = eventHandlerName;
        const metadata = eventHandlerType[Symbol.metadata];
        if (metadata[eventSymbol] != null) {
            this._eventType = metadata[eventSymbol];
        }
        else // observedEvent
         {
            this._eventType = metadata[observedEventSymbol];
            this._isObservedEvent = true;
            given(eventHandlerType, "eventHandlerType").ensureHasValue().ensureIsFunction()
                .ensure(_ => metadata[observableSymbol] != null, `EventHandler '${eventHandlerName}' does not have observable decorator applied.`)
                .ensure(_ => metadata[observerSymbol] != null, `EventHandler '${eventHandlerName}' does not have observer decorator applied.`);
            this._observableType = metadata[observableSymbol];
            this._observableTypeName = this._observableType.getTypeName();
            this._observerType = metadata[observerSymbol];
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
    static generateObservationKey(observerTypeName, observableTypeName, observableEventTypeName) {
        given(observerTypeName, "observerTypeName").ensureHasValue().ensureIsString();
        given(observableTypeName, "observableTypeName").ensureHasValue().ensureIsString();
        given(observableEventTypeName, "observableEventTypeName").ensureHasValue().ensureIsString();
        return `.${observerTypeName}.${observableTypeName}.${observableEventTypeName}`;
    }
}
//# sourceMappingURL=event-registration.js.map