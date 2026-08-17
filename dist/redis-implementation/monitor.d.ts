import { Logger } from "@nivinjoseph/n-log";
import { Disposable } from "@nivinjoseph/n-util";
import { Redis } from "ioredis";
import { Consumer } from "./consumer.js";
import { Broker } from "./broker.js";
export declare class Monitor implements Disposable {
    private readonly _client;
    private readonly _brokers;
    private readonly _consumers;
    private readonly _logger;
    private readonly _listener;
    private _metricsInterval;
    private _hasWarnedMetricsDeprecated;
    private _isRunning;
    private _isDisposed;
    constructor(client: Redis, brokers: ReadonlyArray<Broker>, consumers: ReadonlyArray<Consumer>, logger: Logger);
    start(): Promise<void>;
    dispose(): Promise<void>;
    /**
     * DEPRECATED: superseded by OpenTelemetry metrics and slated for removal in v8. Register
     * a MeterProvider and read `n_eda.partition.lag`, `n_eda.partition.write_index`,
     * `n_eda.partition.read_index` and `n_eda.consumer.poll.age` from the meter named
     * "n-eda" instead.
     *
     * The `productionRate` and `consumptionRate` fields have been removed: they were
     * un-normalized deltas over a variable, unknowable interval, sampled by the consumer on
     * one timer and read here on another, so they were never a rate in any dimension.
     */
    private _initializeMetrics;
}
//# sourceMappingURL=monitor.d.ts.map