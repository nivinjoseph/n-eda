import { RoutedEvent } from "./broker.js";
import { Processor } from "./processor.js";
import { Scheduler } from "./scheduler.js";
/**
 * The scheduler n-eda actually uses: one FIFO queue per partition key, plus a set of keys currently in
 * flight.
 *
 * A key is admitted to a free processor only when it is absent from `_processing`, so **at most one work item
 * per partition key executes at a time, process-wide** — this is the mechanism behind per-key ordering.
 * Distinct keys run concurrently, bounded by the processor count (one per owned partition).
 *
 * Note: empty per-key queues are swept hourly to keep the map from growing without bound.
 */
export declare class OptimizedScheduler implements Scheduler {
    private readonly _queues;
    private readonly _processing;
    private readonly _processors;
    private readonly _partitionQueue;
    private readonly _cleanupDuration;
    private _cleanupTime;
    private _isDisposed;
    constructor(processors: ReadonlyArray<Processor>);
    scheduleWork(routedEvent: RoutedEvent): Promise<void>;
    dispose(): Promise<void>;
    private _executeAvailableWork;
    private _findWork;
}
//# sourceMappingURL=optimized-scheduler.d.ts.map