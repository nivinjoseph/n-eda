import { Logger } from "@nivinjoseph/n-log";
import { Disposable, Duration } from "@nivinjoseph/n-util";
import { TopicPartitionMetrics } from "../topic.js";
import { Broker } from "./broker.js";
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
export interface PartitionMetricRecord extends TopicPartitionMetrics {
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
export declare class MetricsReporter implements Disposable {
    private readonly _brokers;
    private readonly _logger;
    private readonly _consumerGroupId;
    private readonly _consumerName;
    private readonly _interval;
    private _timeout;
    private _isReporting;
    private _isDisposed;
    constructor(brokers: ReadonlyArray<Broker>, logger: Logger, consumerGroupId: string, consumerName: string, interval: Duration);
    start(): void;
    dispose(): Promise<void>;
    /**
     * Builds the records this reporter would log at the given time, one per topic-partition.
     *
     * Note: public because these records are the log contract that dashboards are built against, so they
     * should be assertable directly rather than only through a timer.
     *
     * @param now - epoch milliseconds to measure each sample's age against; the tick time
     * @returns one flat record per partition, ordered by topic then partition
     */
    buildRecords(now: number): Array<PartitionMetricRecord>;
    private _report;
}
//# sourceMappingURL=metrics-reporter.d.ts.map