import { RoutedEvent } from "./broker.js";
import { Processor } from "./processor.js";
import { Scheduler } from "./scheduler.js";
import { SchedulerMetrics } from "../metrics.js";
/**
 * @deprecated Only used for baselining
 */
export declare class DefaultScheduler implements Scheduler {
    private readonly _queues;
    private readonly _processing;
    private readonly _processors;
    get metrics(): SchedulerMetrics;
    constructor(processors: ReadonlyArray<Processor>);
    scheduleWork(routedEvent: RoutedEvent): Promise<void>;
    dispose(): Promise<void>;
    private _executeAvailableWork;
    private _findWork;
}
//# sourceMappingURL=default-scheduler.d.ts.map