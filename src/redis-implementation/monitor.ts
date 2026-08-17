import { given } from "@nivinjoseph/n-defensive";
import { ObjectDisposedException } from "@nivinjoseph/n-exception";
import { Logger } from "@nivinjoseph/n-log";
import { Disposable, Duration } from "@nivinjoseph/n-util";
import { Redis } from "ioredis";
import { Consumer } from "./consumer.js";
import { Broker } from "./broker.js";


export class Monitor implements Disposable
{
    private readonly _client: Redis;
    private readonly _brokers: ReadonlyArray<Broker>;
    private readonly _consumers = new Map<string, Consumer>();
    private readonly _logger: Logger;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    private readonly _listener: Function;
    private _metricsInterval: NodeJS.Timeout | null = null;
    private _hasWarnedMetricsDeprecated = false;
    private _isRunning = false;
    private _isDisposed = false;


    public constructor(client: Redis, brokers: ReadonlyArray<Broker>, consumers: ReadonlyArray<Consumer>, logger: Logger)
    {
        given(client, "client").ensureHasValue().ensureIsObject();
        this._client = client.duplicate();
        
        given(brokers, "brokers").ensureHasValue().ensureIsArray().ensureIsNotEmpty();
        this._brokers = brokers;

        given(consumers, "consumers").ensureHasValue().ensureIsArray().ensureIsNotEmpty();
        consumers.forEach(consumer =>
        {
            this._consumers.set(consumer.id, consumer);
        });

        given(logger, "logger").ensureHasValue().ensureIsObject();
        this._logger = logger;

        this._listener = (_channel: string, id: string): void =>
        {
            // console.log(_channel, id);
            this._consumers.get(id)!.awaken();
        };
    }


    public async start(): Promise<void>
    {
        if (this._isDisposed)
            throw new ObjectDisposedException("Monitor");

        if (this._isRunning)
            return;

        this._isRunning = true;
        
        this._initializeMetrics();

        await this._client.subscribe(...[...this._consumers.values()].map(t => `${t.id}-changed`));
        this._client.on("message", this._listener as any);
    }

    public async dispose(): Promise<void>
    {
        this._isRunning = false;
        if (this._isDisposed)
            return;

        this._isDisposed = true;
        
        if (this._metricsInterval != null)
            clearInterval(this._metricsInterval);
        
        this._client.off("message", this._listener as any);
        await this._client.unsubscribe(...[...this._consumers.values()].map(t => `${t.id}-changed`));
        await this._client.quit();
    }
    
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
    private _initializeMetrics(): void
    {
        this._metricsInterval = setInterval(() =>
        {
            if (!this._hasWarnedMetricsDeprecated)
            {
                this._hasWarnedMetricsDeprecated = true;
                this._logger.logWarning("n-eda partition metrics logging (\"$logType\": \"n-eda-partition-metrics\") is deprecated and will be removed in v8. Register an OpenTelemetry MeterProvider and consume n_eda.partition.lag, n_eda.partition.write_index, n_eda.partition.read_index and n_eda.consumer.poll.age from the meter named \"n-eda\" instead.")
                    .catch(e => console.error(e));
            }

            const metrics = {
                $logType: "n-eda-partition-metrics",
                topics: this._brokers.map(broker => ({
                    topic: broker.topicName,
                    consumerGroupId: broker.consumerGroupId,
                    partitions: [...broker.partitionMetrics.entries()]
                        .orderBy(t => t[0])
                        .map(t => ({
                            partition: t[0],
                            writeIndex: t[1].writeIndex,
                            readIndex: t[1].readIndex,
                            // Counts batches, not events: one publish call per partition is
                            // a single batch regardless of how many events it carries.
                            lag: t[1].writeIndex - t[1].readIndex,
                            lastPolledAt: t[1].lastPolledAt
                        }))
                }))
            };

            this._logger.logInfo(JSON.stringify(metrics))
                .catch(e => console.error(e));
        }, Duration.fromMinutes(1).toMilliSeconds());
    }
}