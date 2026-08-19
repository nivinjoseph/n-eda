import { RoutedEvent } from "./broker.js";
import { Processor } from "./processor.js";
import { Scheduler } from "./scheduler.js";
/**
 * A simpler `Scheduler` retained as a performance baseline.
 *
 * Note: live code, but **unused** — `Broker` always constructs `OptimizedScheduler`. It upholds the same
 * one-in-flight-per-partition-key invariant; it is just slower under load.
 *
 * @deprecated Only used for baselining
 */
export declare class DefaultScheduler implements Scheduler {
    private readonly _queues;
    private readonly _processing;
    private readonly _processors;
    constructor(processors: ReadonlyArray<Processor>);
    scheduleWork(routedEvent: RoutedEvent): Promise<void>;
    dispose(): Promise<void>;
    private _executeAvailableWork;
    private _findWork;
}
//# sourceMappingURL=default-scheduler.d.ts.map