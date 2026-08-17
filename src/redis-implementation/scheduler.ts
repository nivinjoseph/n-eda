import { Deferred, Disposable } from "@nivinjoseph/n-util";
import { RoutedEvent } from "./broker.js";
import { SchedulerMetrics } from "../metrics.js";


export interface Scheduler extends Disposable
{
    readonly metrics: SchedulerMetrics;

    scheduleWork(routedEvent: RoutedEvent): Promise<void>;
}

export interface WorkItem extends RoutedEvent
{
    deferred: Deferred<void>;
    /** Set at enqueue time so the processor can measure how long the item waited. */
    enqueuedAt: number;
}