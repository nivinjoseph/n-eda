import { given } from "@nivinjoseph/n-defensive";
import { Deferred } from "@nivinjoseph/n-util";
import { RoutedEvent } from "./broker.js";
import { Processor } from "./processor.js";
import { Scheduler, WorkItem } from "./scheduler.js";

/**
 * @deprecated Only used for baselining
 */
export class DefaultScheduler implements Scheduler
{
    private readonly _queues = new Map<string, SchedulerQueue>();
    private readonly _processing = new Set<string>();
    private readonly _processors: ReadonlyArray<Processor>;


    public constructor(processors: ReadonlyArray<Processor>)
    {
        given(processors, "processors").ensureHasValue().ensureIsArray().ensure(t => t.isNotEmpty);
        this._processors = processors;

        this._processors.forEach(t =>
        {
            t.availability.subscribe(this._executeAvailableWork.bind(this));
            t.doneProcessing.subscribe((workItem) => this._processing.delete(workItem.partitionKey));
        });
    }
    

    public scheduleWork(routedEvent: RoutedEvent): Promise<void>
    {
        const deferred = new Deferred<void>();

        const workItem: WorkItem = {
            ...routedEvent,
            deferred
        };

        if (this._queues.has(workItem.partitionKey))
            this._queues.get(workItem.partitionKey)!.queue.unshift(workItem);
        else
            this._queues.set(workItem.partitionKey, {
                partitionKey: workItem.partitionKey,
                // lastAccessed: Date.now(),
                queue: [workItem]
            });

        this._executeAvailableWork();

        return workItem.deferred.promise;
    }
    
    public dispose(): Promise<void>
    {
        return Promise.resolve();
    }

    private _executeAvailableWork(processor?: Processor): void
    {
        const availableProcessor = processor ?? this._processors.find(t => !t.isBusy);
        if (availableProcessor == null)
            return;

        const workItem = this._findWork();
        if (workItem == null)
            return;

        availableProcessor.process(workItem);
        this._processing.add(workItem.partitionKey);
    }

    // private _findWork(): WorkItem | null
    // {
    //     // FIXME: this is a shitty priority queue
    //     const entries = [...this._queues.values()].orderBy(t => t.lastAccessed);

    //     for (const entry of entries)
    //     {
    //         if (entry.queue.isEmpty)
    //         {
    //             this._queues.delete(entry.partitionKey);
    //             continue;
    //         }

    //         if (this._processing.has(entry.partitionKey))
    //             continue;

    //         const workItem = entry.queue.pop()!;
    //         if (entry.queue.isEmpty)
    //             this._queues.delete(entry.partitionKey);
    //         else
    //             entry.lastAccessed = Date.now();

    //         return workItem;
    //     }

    //     return null;
    // }

    private _findWork(): WorkItem | null
    {
        // Because we know that Map.Values() returns entries in insertion order
        for (const entry of this._queues.values())
        {
            if (entry.queue.isEmpty)
            {
                this._queues.delete(entry.partitionKey);
                continue;
            }

            if (this._processing.has(entry.partitionKey))
                continue;

            const workItem = entry.queue.pop()!;
            this._queues.delete(entry.partitionKey);
            if (entry.queue.isNotEmpty)
            {
                // entry.lastAccessed = Date.now();
                this._queues.set(entry.partitionKey, entry);
            }

            return workItem;
        }

        return null;
    }
}


interface SchedulerQueue
{
    partitionKey: string;
    // lastAccessed: number;
    queue: Array<WorkItem>;
}