import * as otelApi from "@opentelemetry/api";
/**
 * The value of the `messaging.system` attribute on every metric this framework emits.
 */
export declare const MESSAGING_SYSTEM = "n-eda";
/**
 * Custom attribute keys. Kept as constants so call sites cannot drift.
 */
export declare const ATTR_NEDA_EVENT_NAME = "n_eda.event.name";
export declare const ATTR_NEDA_COMPONENT = "n_eda.component";
export declare const ATTR_NEDA_OUTCOME = "n_eda.outcome";
export declare const ATTR_NEDA_DROP_REASON = "n_eda.drop.reason";
export declare const ATTR_NEDA_SKIP_REASON = "n_eda.skip.reason";
export declare const ATTR_NEDA_DIRECTION = "n_eda.direction";
export declare const ATTR_NEDA_PROXY_KIND = "n_eda.proxy.kind";
export type NedaComponent = "producer" | "consumer" | "event-bus" | "monitor";
export type NedaProcessOutcome = "success" | "retry" | "exhausted";
export type NedaDropReason = "read_failed" | "process_failed";
export type NedaSkipReason = "duplicate" | "no_registration" | "tracked_keys_cleared";
export type NedaDirection = "publish" | "consume";
export type NedaProxyKind = "aws-lambda" | "rpc" | "grpc";
export interface PartitionIndexes {
    writeIndex: number;
    readIndex: number;
    lastPolledAt: number;
}
export interface SchedulerMetrics {
    /** Work items waiting for a processor. */
    readonly queueDepth: number;
    /** Partition keys with an in-flight item; these block their whole queue. */
    readonly blockedPartitionKeys: number;
    /** Partition keys with a queue allocated. Grows until the hourly cleanup, so a leak detector. */
    readonly trackedPartitionKeys: number;
    readonly availableProcessors: number;
}
/**
 * Implemented by `Broker`. Registered sources are read by a batch observable callback on
 * every collection cycle, so the values they expose must be cheap to read and must never
 * touch the network.
 */
export interface PartitionMetricsSource {
    readonly topicName: string;
    readonly consumerGroupId: string;
    readonly partitionMetrics: ReadonlyMap<number, PartitionIndexes>;
    readonly schedulerMetrics: SchedulerMetrics;
    /** Tracked-key set size per partition, used for de-duplication. */
    readonly trackedKeyCounts: ReadonlyMap<number, number>;
}
export interface NedaInstruments {
    readonly sentMessages: otelApi.Counter;
    readonly consumedMessages: otelApi.Counter;
    readonly clientOperationDuration: otelApi.Histogram;
    readonly processDuration: otelApi.Histogram;
    readonly handlerDuration: otelApi.Histogram;
    readonly processAttempts: otelApi.Counter;
    readonly eventDropped: otelApi.Counter;
    readonly eventSkipped: otelApi.Counter;
    readonly consumerReadAttempts: otelApi.Histogram;
    readonly consumerBatchSize: otelApi.Histogram;
    readonly consumerLoopErrors: otelApi.Counter;
    readonly redisCommandDuration: otelApi.Histogram;
    readonly redisPipelineErrors: otelApi.Counter;
    readonly schedulerWaitDuration: otelApi.Histogram;
    readonly payloadSize: otelApi.Histogram;
    readonly compressionDuration: otelApi.Histogram;
    readonly batchMessageCount: otelApi.Histogram;
    readonly observerLookupDuration: otelApi.Histogram;
    readonly observerSubscribers: otelApi.Histogram;
    readonly proxyDuration: otelApi.Histogram;
}
/**
 * Returns this framework's instruments, creating them on first use.
 *
 * The cache is keyed on the identity of the global `MeterProvider`, not memoized once.
 * This matters: unlike `trace.getTracer`, `metrics.getMeter` has no ProxyMeterProvider --
 * it resolves `getGlobal("metrics") || NOOP_METER_PROVIDER` immediately. A one-shot memo
 * would permanently bind Noop instruments if any code path recorded a measurement before
 * the host registered its SDK, silently killing metrics forever. Keying on provider
 * identity self-heals on late registration, on `metrics.disable()`, and on
 * re-registration between test files.
 */
export declare function instruments(): NedaInstruments;
/**
 * Must be called from `Broker.initialize()`.
 */
export declare function registerPartitionMetricsSource(source: PartitionMetricsSource): void;
/**
 * Must be called as the FIRST statement of `Broker.dispose()` -- before the awaited
 * disposal of consumers and processors, whose trailing catch would otherwise skip it.
 * A missed unregister is both a memory leak and a correctness bug: the registry holds a
 * strong reference and the disposed broker keeps reporting frozen, stale lag forever.
 */
export declare function unregisterPartitionMetricsSource(source: PartitionMetricsSource): void;
/**
 * Times a Redis command and records it against `n_eda.redis.command.duration`.
 *
 * Wraps the INNER function that `Make.retryWithExponentialBackoff` invokes once per
 * attempt, so every failed attempt records its own datapoint carrying `error.type`.
 * That makes retries derivable without touching `Make`.
 */
export declare function timeRedisCommand<T>(operation: string, component: NedaComponent, exec: () => Promise<T>): Promise<T>;
/**
 * Derives the `error.type` attribute value. Uses the exception class name only -- never
 * the message, which is unbounded and would blow up cardinality.
 */
export declare function errorTypeOf(error: unknown): string;
//# sourceMappingURL=metrics.d.ts.map