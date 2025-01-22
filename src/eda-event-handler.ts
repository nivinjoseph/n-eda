import { ClassDefinition } from "@nivinjoseph/n-util";
import { EdaEvent } from "./eda-event.js";

// public
export interface EdaEventHandler<TEvent extends EdaEvent>
{
    handle(event: TEvent): Promise<void>;
}

export type EventHandlerClass<TEvent extends EdaEvent, TEventHandler extends EdaEventHandler<TEvent>> = ClassDefinition<TEventHandler>;