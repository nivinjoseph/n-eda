import { given } from "@nivinjoseph/n-defensive";
import { Serializable, serialize } from "@nivinjoseph/n-util";
import { EdaEvent } from "../eda-event.js";

@serialize("Neda")
/**
 * The envelope that carries an observed event to one specific observer instance.
 *
 * Contract: created by `RedisEventBus.publish` for each subscriber found in the observable's Redis set, and
 * published to the topic registered with `EdaManager.enableDistributedObserver(...)`. Its `partitionKey` is
 * the `observerId`, so every notification for a given observer is processed in order; its `id` combines
 * observer type, observer id, and the inner event id, making it unique per (observer, event) pair.
 *
 * The consumer recognizes it by name, rebuilds the observation key from `observerTypeName` plus the inner
 * event's `refType` and `name`, and `DefaultProcessor` unwraps `observedEvent` before calling the handler.
 *
 * Note: internal framework event — you never construct one.
 */
export class NedaDistributedObserverNotifyEvent extends Serializable implements EdaEvent
{
    private readonly _observerTypeName: string;
    private readonly _observerId: string;
    private readonly _observedEventId: string;
    private readonly _observedEvent: EdaEvent;


    @serialize
    public get observerTypeName(): string { return this._observerTypeName; }
    
    @serialize
    public get observerId(): string { return this._observerId; }
    
    @serialize
    public get observedEventId(): string { return this._observedEventId; }
    
    @serialize
    public get observedEvent(): EdaEvent { return this._observedEvent; }
    
    @serialize // event though it is computed, we will deliberately serialize it fo it is visible in the json
    public get id(): string { return `${this.observerTypeName}.${this.observerId}.${this.observedEventId}`; }
    
    @serialize // has to be serialized for eda purposes
    public get name(): string { return (<Object>NedaDistributedObserverNotifyEvent).getTypeName(); }
    
    public get partitionKey(): string { return this.observerId; }
    
    public get refId(): string { return this.observerId; }
    public get refType(): string { return this.observerTypeName; }
   
    
    public constructor(data: Pick<NedaDistributedObserverNotifyEvent,
        "observerTypeName" | "observerId" | "observedEventId" | "observedEvent">)
    {
        super(data);

        const { observerTypeName, observerId, observedEventId, observedEvent } = data;

        given(observerTypeName, "observerTypeName").ensureHasValue().ensureIsString();
        this._observerTypeName = observerTypeName;
        
        given(observerId, "observerId").ensureHasValue().ensureIsString();
        this._observerId = observerId;
        
        given(observedEventId, "observedEventId").ensureHasValue().ensureIsString();
        this._observedEventId = observedEventId;
        
        given(observedEvent, "observedEvent").ensureHasValue().ensureIsObject();
        this._observedEvent = observedEvent;
    }
}