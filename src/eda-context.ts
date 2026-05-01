import { given } from "@nivinjoseph/n-defensive";

export interface EdaContext
{
    get topic(): string;
}

export class DefaultEdaContext implements EdaContext
{
    private _topic: string | null = null;
    
    
    public get topic(): string
    {
        given(this, "this").ensure(t => t._topic != null, "topic not set");
        return this._topic!;
    }
    
    public set topic(value: string)
    {
        given(value, "topic").ensureHasValue().ensureIsString();
        this._topic = value.trim();
    }
}