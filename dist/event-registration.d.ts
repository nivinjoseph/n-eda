import { ClassDefinition } from "@nivinjoseph/n-util";
import { EdaEventHandler } from "./eda-event-handler.js";
import { ObserverEdaEventHandler } from "./observer-eda-event-handler.js";
import { EdaEvent } from "./eda-event.js";
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
    /** The decorated handler class itself. */
    get eventHandlerType(): ClassDefinition<EdaEventHandler<EdaEvent>> | ClassDefinition<ObserverEdaEventHandler<EdaEvent>>;
    /**
     * The handler class's name — also its DI registration key, which is why handler class names must be
     * globally unique across an application.
     */
    get eventHandlerTypeName(): string;
    /** The event class this handler processes, taken from `@event` or `@observedEvent`. */
    get eventType(): ClassDefinition<EdaEvent>;
    /** The event class's name — the value a published event's `name` must match to route here. */
    get eventTypeName(): string;
    /** `true` when the handler was declared with `@observedEvent` rather than `@event`. */
    get isObservedEvent(): boolean;
    /**
     * The class passed to `@observable`.
     *
     * @throws if this is not an observed-event registration
     */
    get observableType(): ClassDefinition<any>;
    /**
     * Name of the `@observable` class — must equal the published event's `refType`.
     *
     * @throws if this is not an observed-event registration
     */
    get observableTypeName(): string;
    /**
     * The class passed to `@observer`.
     *
     * @throws if this is not an observed-event registration
     */
    get observerType(): ClassDefinition<any>;
    /**
     * Name of the `@observer` class.
     *
     * @throws if this is not an observed-event registration
     */
    get observerTypeName(): string;
    /**
     * The composite key this handler is indexed under in `EdaManager.observerEventMap`.
     *
     * @throws if this is not an observed-event registration
     */
    get observationKey(): string;
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
    constructor(eventHandlerType: ClassDefinition<EdaEventHandler<EdaEvent>> | ClassDefinition<ObserverEdaEventHandler<EdaEvent>>);
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
    static generateObservationKey(observerTypeName: string, observableTypeName: string, observableEventTypeName: string): string;
}
//# sourceMappingURL=event-registration.d.ts.map