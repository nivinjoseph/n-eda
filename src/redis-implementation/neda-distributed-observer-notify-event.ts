import { given } from "@nivinjoseph/n-defensive";
import { Serializable, serialize } from "@nivinjoseph/n-util";
import { EdaEvent } from "../eda-event.js";

@serialize
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