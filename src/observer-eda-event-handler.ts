import { ClassDefinition } from "@nivinjoseph/n-util";
import { EdaEvent } from "./eda-event.js";

// public
export interface ObserverEdaEventHandler<TEvent extends EdaEvent>
{
    handle(event: TEvent, observerId: string): Promise<void>;
}

export type ObserverEdaEventHandlerClass<TEvent extends EdaEvent, This extends ObserverEdaEventHandler<TEvent>> = ClassDefinition<This>;