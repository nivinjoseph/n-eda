import { Deferred, Disposable } from "@nivinjoseph/n-util";
import { RoutedEvent } from "./broker";


export interface Scheduler extends Disposable
{
    scheduleWork(routedEvent: RoutedEvent): Promise<void>;
}

export interface WorkItem extends RoutedEvent
{
    deferred: Deferred<void>;
}