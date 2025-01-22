import { given } from "@nivinjoseph/n-defensive";
import { Deferred } from "@nivinjoseph/n-util";
/**
 * @deprecated Only used for baselining
 */
export class DefaultScheduler {
    constructor(processors) {
        this._queues = new Map();
        this._processing = new Set();
        given(processors, "processors").ensureHasValue().ensureIsArray().ensure(t => t.isNotEmpty);
        this._processors = processors;
        this._processors.forEach(t => {
            t.availability.subscribe(this._executeAvailableWork.bind(this));
            t.doneProcessing.subscribe((workItem) => this._processing.delete(workItem.partitionKey));
        });
    }
    scheduleWork(routedEvent) {
        const deferred = new Deferred();
        const workItem = Object.assign(Object.assign({}, routedEvent), { deferred });
        if (this._queues.has(workItem.partitionKey))
            this._queues.get(workItem.partitionKey).queue.unshift(workItem);
        else
            this._queues.set(workItem.partitionKey, {
                partitionKey: workItem.partitionKey,
                // lastAccessed: Date.now(),
                queue: [workItem]
            });
        this._executeAvailableWork();
        return workItem.deferred.promise;
    }
    dispose() {
        return Promise.resolve();
    }
    _executeAvailableWork(processor) {
        const availableProcessor = processor !== null && processor !== void 0 ? processor : this._processors.find(t => !t.isBusy);
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
    _findWork() {
        // Because we know that Map.Values() returns entries in insertion order
        for (const entry of this._queues.values()) {
            if (entry.queue.isEmpty) {
                this._queues.delete(entry.partitionKey);
                continue;
            }
            if (this._processing.has(entry.partitionKey))
                continue;
            const workItem = entry.queue.pop();
            this._queues.delete(entry.partitionKey);
            if (entry.queue.isNotEmpty) {
                // entry.lastAccessed = Date.now();
                this._queues.set(entry.partitionKey, entry);
            }
            return workItem;
        }
        return null;
    }
}
//# sourceMappingURL=default-scheduler.js.map