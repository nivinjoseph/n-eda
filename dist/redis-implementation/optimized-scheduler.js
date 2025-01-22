import { given } from "@nivinjoseph/n-defensive";
import { ObjectDisposedException } from "@nivinjoseph/n-exception";
import { Deferred, Duration } from "@nivinjoseph/n-util";
import { Queue } from "./queue.js";
export class OptimizedScheduler {
    constructor(processors) {
        this._queues = new Map();
        this._processing = new Set();
        this._processors = new Queue();
        this._partitionQueue = new Queue();
        this._cleanupDuration = Duration.fromHours(1).toMilliSeconds();
        this._cleanupTime = Date.now() + this._cleanupDuration;
        this._isDisposed = false;
        given(processors, "processors").ensureHasValue().ensureIsArray().ensure(t => t.isNotEmpty);
        processors.forEach(t => {
            this._processors.enqueue(t);
            t.availability.subscribe((proc) => {
                this._processors.enqueue(proc);
                this._executeAvailableWork();
            });
            t.doneProcessing.subscribe((workItem) => this._processing.delete(workItem.partitionKey));
        });
    }
    scheduleWork(routedEvent) {
        if (this._isDisposed)
            return Promise.reject(new ObjectDisposedException("Scheduler"));
        const deferred = new Deferred();
        const workItem = Object.assign(Object.assign({}, routedEvent), { deferred });
        const queue = this._queues.get(workItem.partitionKey);
        if (queue)
            queue.enqueue(workItem);
        else
            this._queues.set(workItem.partitionKey, new Queue([workItem]));
        this._partitionQueue.enqueue(workItem.partitionKey);
        this._executeAvailableWork();
        return workItem.deferred.promise;
    }
    dispose() {
        if (!this._isDisposed) {
            this._isDisposed = true;
            // console.warn("Disposing scheduler");
            let work = this._findWork();
            while (work != null) {
                work.deferred.reject(new ObjectDisposedException("Scheduler"));
                work = this._findWork();
            }
            // console.warn("Scheduler disposed");
        }
        return Promise.resolve();
    }
    _executeAvailableWork() {
        if (this._processors.isEmpty)
            return;
        const workItem = this._findWork();
        if (workItem === null)
            return;
        const availableProcessor = this._processors.dequeue();
        availableProcessor.process(workItem);
        this._processing.add(workItem.partitionKey);
    }
    _findWork() {
        if (!this._isDisposed && this._cleanupTime < Date.now()) {
            for (const entry of this._queues.entries()) {
                if (entry[1].isEmpty)
                    this._queues.delete(entry[0]);
            }
            this._cleanupTime = Date.now() + this._cleanupDuration;
        }
        if (this._partitionQueue.isEmpty)
            return null;
        let cycle = 0;
        while (cycle < this._partitionQueue.length) {
            const partitionKey = this._partitionQueue.dequeue();
            if (!this._isDisposed && this._processing.has(partitionKey)) {
                this._partitionQueue.enqueue(partitionKey);
                cycle++;
                continue;
            }
            const queue = this._queues.get(partitionKey);
            if (queue.isEmpty)
                continue;
            return queue.dequeue();
        }
        return null;
    }
}
//# sourceMappingURL=optimized-scheduler.js.map