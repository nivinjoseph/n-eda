import { given } from "@nivinjoseph/n-defensive";
import { eventSymbol } from "./event.js";
import { observableSymbol, observedEventSymbol, observerSymbol } from "./observed-event.js";
/**
 * The reflected result of applying n-eda's decorators to a handler class — what the framework knows about a
 * handler after `registerEventHandlers` has looked at it.
 *
 * Contract: constructed internally by `EdaManager.registerEventHandlers` and surfaced read-only through
 * `EdaManager.eventMap` (keyed by event type name) and `EdaManager.observerEventMap` (keyed by
 * {@link EventRegistration.observationKey}). You rarely construct one directly.
 *
 * The constructor is where decorator misuse is caught: a handler must carry exactly one of `@event` or
 * `@observedEvent`, and an observed-event handler must additionally carry both `@observable` and
 * `@observer`.
 */
// public
export class EventRegistration {
    _eventHandlerType;
    _eventHandlerTypeName;
    _eventType;
    _eventTypeName;
    _isObservedEvent = false;
    _observableType = null;
    _observableTypeName = null;
    _observerType = null;
    _observerTypeName = null;
    /** The decorated handler class itself. */
    get eventHandlerType() { return this._eventHandlerType; }
    /**
     * The handler class's name — also its DI registration key, which is why handler class names must be
     * globally unique across an application.
     */
    get eventHandlerTypeName() { return this._eventHandlerTypeName; }
    /** The event class this handler processes, taken from `@event` or `@observedEvent`. */
    get eventType() { return this._eventType; }
    /** The event class's name — the value a published event's `name` must match to route here. */
    get eventTypeName() { return this._eventTypeName; }
    /** `true` when the handler was declared with `@observedEvent` rather than `@event`. */
    get isObservedEvent() { return this._isObservedEvent; }
    /**
     * The class passed to `@observable`.
     *
     * @throws if this is not an observed-event registration
     */
    get observableType() {
        given(this, "this").ensure(t => t._isObservedEvent, "not observed event");
        return this._observableType;
    }
    /**
     * Name of the `@observable` class — must equal the published event's `refType`.
     *
     * @throws if this is not an observed-event registration
     */
    get observableTypeName() {
        given(this, "this").ensure(t => t._isObservedEvent, "not observed event");
        return this._observableTypeName;
    }
    /**
     * The class passed to `@observer`.
     *
     * @throws if this is not an observed-event registration
     */
    get observerType() {
        given(this, "this").ensure(t => t._isObservedEvent, "not observed event");
        return this._observerType;
    }
    /**
     * Name of the `@observer` class.
     *
     * @throws if this is not an observed-event registration
     */
    get observerTypeName() {
        given(this, "this").ensure(t => t._isObservedEvent, "not observed event");
        return this._observerTypeName;
    }
    /**
     * The composite key this handler is indexed under in `EdaManager.observerEventMap`.
     *
     * @throws if this is not an observed-event registration
     */
    get observationKey() {
        return EventRegistration.generateObservationKey(this.observerTypeName, this.observableTypeName, this.eventTypeName);
    }
    /**
     * Reflects a decorated handler class, reading `Symbol.metadata` for the registration symbols written by
     * `@event` / `@observedEvent` / `@observable` / `@observer`.
     *
     * Note: because the metadata is written by decorators at class-definition time, a handler class that was
     * never decorated — or was compiled with `experimentalDecorators` instead of standard decorators — fails
     * here rather than at dispatch time.
     *
     * @param eventHandlerType - the decorated handler class
     * @throws if the class has no decorator metadata, has neither `@event` nor `@observedEvent`, has both, or
     * is an observed-event handler missing `@observable` or `@observer`
     */
    constructor(eventHandlerType) {
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
    /**
     * Builds the composite key that identifies one (observer, observable, event) triple.
     *
     * Contract: the format is `` `.${observer}.${observable}.${event}` `` — note the **leading dot**. This is
     * the key `EdaManager.observerEventMap` is indexed by, so a lookup with a bare event name never matches.
     *
     * @param observerTypeName - name of the watching type
     * @param observableTypeName - name of the emitting type; must equal the event's `refType`
     * @param observableEventTypeName - name of the observed event type
     * @returns the observation key
     * @throws if any argument is missing or not a string
     */
    static generateObservationKey(observerTypeName, observableTypeName, observableEventTypeName) {
        given(observerTypeName, "observerTypeName").ensureHasValue().ensureIsString();
        given(observableTypeName, "observableTypeName").ensureHasValue().ensureIsString();
        given(observableEventTypeName, "observableEventTypeName").ensureHasValue().ensureIsString();
        return `.${observerTypeName}.${observableTypeName}.${observableEventTypeName}`;
    }
}
//# sourceMappingURL=event-registration.js.map