import { given } from "@nivinjoseph/n-defensive";
import { Serializable, serialize } from "@nivinjoseph/n-util";
import { EdaEvent } from "../eda-event.js";

@serialize
export class NedaClearTrackedKeysEvent extends Serializable implements EdaEvent
{
    private readonly _id: string;
    
    
    @serialize
    public get id(): string { return this._id; }
    
    @serialize// has to be serialized for eda purposes
    public get name(): string { return (<Object>NedaClearTrackedKeysEvent).getTypeName(); }
    
    public get partitionKey(): string { return this.name; }
    
    public get refId(): string { return this.id; }
    
    public get refType(): string { return "neda"; }
    
    public constructor(data: Pick<NedaClearTrackedKeysEvent, "id">)
    {
        super(data);

        const { id } = data;

        given(id, "id").ensureHasValue().ensureIsString();
        this._id = id;
    }
}