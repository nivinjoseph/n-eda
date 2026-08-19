import { given } from "@nivinjoseph/n-defensive";
import { ObjectDisposedException } from "@nivinjoseph/n-exception";
import { Logger } from "@nivinjoseph/n-log";
import { Disposable, Duration } from "@nivinjoseph/n-util";
import { TopicPartitionMetrics } from "../topic.js";
import { Broker } from "./broker.js";


/**
 * Marks a log line as a partition metrics record. A log pipeline filters on this
 * (`@logType:n-eda.partition-metrics`) to pick out exactly these lines.
 */
const partitionMetricsLogType = "n-eda.partition-metrics";

/**
 * How far behind a partition may fall before each reporting tick calls it out on its own warning line.
 *
 * Chosen well above the consumer's `maxRead` of 50 — a partition briefly exceeding one read batch is normal
 * under load and already throttles itself, whereas a backlog this deep will not drain on its own.
 */
const maxAcceptableLag = 1000;


/**
 * One partition's figures as a single flat log record.
 *
 * RULE: every value here must stay a scalar — no nested objects, no arrays — and no field may take a name
 * the log platform reserves (`timestamp`, `status`, `host`, `date`, ...). These records are logged for
 * ingestion by Datadog, whose log-based metrics can only read flat attributes off a single log event and
 * whose remappers hijack reserved names. Either mistake breaks the dashboards silently rather than failing
 * loudly; the tests in `test/metrics.test.ts` guard both.
 *
 * Note: internal telemetry type; not exported from the barrel. See `docs/observability.md`.
 */
export interface PartitionMetricRecord extends TopicPartitionMetrics
{
    logType: string;
    topic: string;
    partition: number;
    /** The consumer group whose read offset produced `readIndex`, `lag`, and `consumptionRate`. */
    consumerGroupId: string;
    /** Instance label from `useConsumerName` (`"UNNAMED"` if never set) — identifies which replica reported. */
    consumerName: string;
    sampleAgeMs: number;
}


/**
 * Periodically logs every broker's per-partition throughput and lag, one flat JSON line per partition, for
 * a log pipeline to parse into dashboard metrics.
 *
 * Contract: created by `RedisEventSubMgr.consume()` over all brokers, one per process. `start()` installs
 * the timer; `dispose()` clears it. Both are idempotent, and `start()` after disposal throws.
 *
 * RULE: one line per topic-partition, never an aggregate — see {@link PartitionMetricRecord}. Ingest volume
 * is therefore `topics × partitions` lines per interval, which is what `EdaManager.configureMetricsInterval`
 * exists to control.
 *
 * Note: purely a reader of `Broker.metrics` — it holds no Redis connection and never writes. The figures it
 * logs are refreshed by consumers on their own schedule, so a record may be re-logged unrefreshed; the
 * rates are per-minute precisely so that stays harmless, and `sampleAgeMs` reports how stale it is.
 */
export class MetricsReporter implements Disposable
{
    private readonly _brokers: ReadonlyArray<Broker>;
    private readonly _logger: Logger;
    private readonly _consumerGroupId: string;
    private readonly _consumerName: string;
    private readonly _interval: Duration;
    private _timeout: NodeJS.Timeout | null = null;
    private _isReporting = false;
    private _isDisposed = false;


    public constructor(brokers: ReadonlyArray<Broker>, logger: Logger, consumerGroupId: string,
        consumerName: string, interval: Duration)
    {
        given(brokers, "brokers").ensureHasValue().ensureIsArray().ensureIsNotEmpty();
        this._brokers = brokers;

        given(logger, "logger").ensureHasValue().ensureIsObject();
        this._logger = logger;

        given(consumerGroupId, "consumerGroupId").ensureHasValue().ensureIsString();
        this._consumerGroupId = consumerGroupId;

        given(consumerName, "consumerName").ensureHasValue().ensureIsString();
        this._consumerName = consumerName;

        given(interval, "interval").ensureHasValue().ensure(t => t.toMilliSeconds() > 0, "must be greater than zero");
        this._interval = interval;
    }


    public start(): void
    {
        if (this._isDisposed)
            throw new ObjectDisposedException("MetricsReporter");

        if (this._timeout != null)
            return;

        this._timeout = setInterval(() =>
        {
            // A slow logger must not accumulate unbounded pending writes across ticks; skip this tick if the
            // previous one is still draining.
            if (this._isReporting)
                return;

            this._isReporting = true;
            this._report(Date.now())
                .catch(e => console.error(e))
                .finally(() => this._isReporting = false);
        }, this._interval.toMilliSeconds());

        // Telemetry alone should never be the reason the process stays alive.
        this._timeout.unref();
    }

    public dispose(): Promise<void>
    {
        if (this._isDisposed)
            return Promise.resolve();

        this._isDisposed = true;

        if (this._timeout != null)
        {
            clearInterval(this._timeout);
            this._timeout = null;
        }

        return Promise.resolve();
    }

    /**
     * Builds the records this reporter would log at the given time, one per topic-partition.
     *
     * Note: public because these records are the log contract that dashboards are built against, so they
     * should be assertable directly rather than only through a timer.
     *
     * @param now - epoch milliseconds to measure each sample's age against; the tick time
     * @returns one flat record per partition, ordered by topic then partition
     */
    public buildRecords(now: number): Array<PartitionMetricRecord>
    {
        return this._brokers.flatMap(broker =>
            [...broker.metrics.entries()]
                .orderBy(t => t[0])
                .map(([partition, metrics]) => ({
                    logType: partitionMetricsLogType,
                    topic: broker.topic.name,
                    partition,
                    consumerGroupId: this._consumerGroupId,
                    consumerName: this._consumerName,
                    ...metrics,

                    // Precomputed because log query languages cannot do date arithmetic, and clamped because
                    // a backwards clock step would otherwise emit a negative age — which passes the
                    // documented `@sampleAgeMs:<N` staleness filter and makes frozen records look fresh.
                    sampleAgeMs: Math.max(0, now - metrics.sampledAt)
                })));
    }

    private async _report(now: number): Promise<void>
    {
        const logCalls = this.buildRecords(now).flatMap(record =>
        {
            const calls = [this._logger.logInfo(JSON.stringify(record))];

            // Kept human-readable and without a logType, so it never reaches the metrics pipeline. Alerting
            // is better served by a monitor on the generated lag metric.
            if (record.lag > maxAcceptableLag)
                calls.push(this._logger.logWarning(
                    `Event queue lag for topic ${record.topic} partition ${record.partition} is ${record.lag} `
                    + `(threshold ${maxAcceptableLag}); consuming ${record.consumptionRate}/min against `
                    + `${record.productionRate}/min produced.`));

            return calls;
        });

        await Promise.all(logCalls);
    }
}
