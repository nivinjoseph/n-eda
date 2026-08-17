import * as otelApi from "@opentelemetry/api";
import { ATTR_DB_OPERATION_NAME, ATTR_ERROR_TYPE } from "@opentelemetry/semantic-conventions";
import { ATTR_MESSAGING_CONSUMER_GROUP_NAME, ATTR_MESSAGING_DESTINATION_NAME, ATTR_MESSAGING_DESTINATION_PARTITION_ID, ATTR_MESSAGING_SYSTEM, METRIC_MESSAGING_CLIENT_CONSUMED_MESSAGES, METRIC_MESSAGING_CLIENT_OPERATION_DURATION, METRIC_MESSAGING_CLIENT_SENT_MESSAGES, METRIC_MESSAGING_PROCESS_DURATION } from "@opentelemetry/semantic-conventions/incubating";
// internal
// This module is deliberately NOT exported from index.ts. The public contract is the
// meter name ("n-eda") plus the metric names and attributes, which live in the README.
/**
 * The value of the `messaging.system` attribute on every metric this framework emits.
 */
export const MESSAGING_SYSTEM = "n-eda";
const METER_NAME = "n-eda";
/**
 * Custom attribute keys. Kept as constants so call sites cannot drift.
 */
export const ATTR_NEDA_EVENT_NAME = "n_eda.event.name";
export const ATTR_NEDA_COMPONENT = "n_eda.component";
export const ATTR_NEDA_OUTCOME = "n_eda.outcome";
export const ATTR_NEDA_DROP_REASON = "n_eda.drop.reason";
export const ATTR_NEDA_SKIP_REASON = "n_eda.skip.reason";
export const ATTR_NEDA_DIRECTION = "n_eda.direction";
export const ATTR_NEDA_PROXY_KIND = "n_eda.proxy.kind";
/**
 * Explicit bucket boundaries are mandatory. The SDK default boundaries are millisecond
 * shaped, so recording seconds against them collapses every measurement into bucket 0 --
 * a metric that looks broken-but-plausible.
 */
const _latencyBucketsSeconds = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];
/**
 * Processing spans all retry attempts, whose backoff schedule reaches ~9.5 minutes,
 * so this needs a long tail the plain latency buckets do not have.
 */
const _processBucketsSeconds = [..._latencyBucketsSeconds, 30, 60, 120, 300, 600];
const _redisBucketsSeconds = [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
/**
 * The consumer clamps a batch to `readIndex + maxRead - 1` over a lower bound of
 * `readIndex + 1`, so a saturated batch is 49 keys, not 50.
 */
const _batchSizeBuckets = [1, 2, 5, 10, 20, 30, 40, 49];
const _readAttemptBuckets = [1, 2, 3, 5, 10, 25, 50, 100, 200];
/** Queue waits span a much wider range than a Redis round trip, hence its own boundaries. */
const _schedulerWaitBucketsSeconds = [0.001, 0.01, 0.1, 1, 5, 15, 60, 300];
const _payloadSizeBuckets = [256, 1024, 4096, 16384, 65536, 262144, 1048576];
const _batchMessageCountBuckets = [1, 2, 5, 10, 50, 100, 500, 1000, 5000];
const _sources = new Set();
let _cachedProvider = null;
let _cachedInstruments = null;
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
export function instruments() {
    const provider = otelApi.metrics.getMeterProvider();
    if (_cachedInstruments === null || _cachedProvider !== provider) {
        _cachedProvider = provider;
        _cachedInstruments = _createInstruments(provider.getMeter(METER_NAME));
    }
    return _cachedInstruments;
}
/**
 * Must be called from `Broker.initialize()`.
 */
export function registerPartitionMetricsSource(source) {
    _sources.add(source);
    // The partition observables and their batch callback are created inside
    // _createInstruments, so they do not exist until something asks for the instruments.
    // Touching them here means a registered source is observable immediately rather than
    // from whenever the first measurement happens to be recorded.
    instruments();
}
/**
 * Must be called as the FIRST statement of `Broker.dispose()` -- before the awaited
 * disposal of consumers and processors, whose trailing catch would otherwise skip it.
 * A missed unregister is both a memory leak and a correctness bug: the registry holds a
 * strong reference and the disposed broker keeps reporting frozen, stale lag forever.
 */
export function unregisterPartitionMetricsSource(source) {
    _sources.delete(source);
}
/**
 * Times a Redis command and records it against `n_eda.redis.command.duration`.
 *
 * Wraps the INNER function that `Make.retryWithExponentialBackoff` invokes once per
 * attempt, so every failed attempt records its own datapoint carrying `error.type`.
 * That makes retries derivable without touching `Make`.
 */
export async function timeRedisCommand(operation, component, exec) {
    const startedAt = performance.now();
    let errorType = null;
    try {
        return await exec();
    }
    catch (error) {
        errorType = errorTypeOf(error);
        throw error;
    }
    finally {
        const attributes = {
            [ATTR_DB_OPERATION_NAME]: operation,
            [ATTR_NEDA_COMPONENT]: component
        };
        if (errorType !== null)
            attributes[ATTR_ERROR_TYPE] = errorType;
        instruments().redisCommandDuration.record((performance.now() - startedAt) / 1000, attributes);
    }
}
/**
 * Derives the `error.type` attribute value. Uses the exception class name only -- never
 * the message, which is unbounded and would blow up cardinality.
 */
export function errorTypeOf(error) {
    if (error instanceof Error)
        return error.constructor.name;
    return "_OTHER";
}
function _createInstruments(meter) {
    const partitionWriteIndex = meter.createObservableCounter("n_eda.partition.write_index", {
        description: "Redis write index for a topic partition. Monotonic; let the backend compute the rate. Aggregate across replicas with max, never sum.",
        unit: "{message}",
        valueType: otelApi.ValueType.INT
    });
    const partitionReadIndex = meter.createObservableCounter("n_eda.partition.read_index", {
        description: "Redis read index for a topic partition and consumer group. Monotonic; let the backend compute the rate.",
        unit: "{message}",
        valueType: otelApi.ValueType.INT
    });
    const partitionLag = meter.createObservableGauge("n_eda.partition.lag", {
        description: "Write index minus read index. NOTE: counts batches, not events -- one publish call per partition is a single batch.",
        unit: "{message}",
        valueType: otelApi.ValueType.INT
    });
    const consumerPollAge = meter.createObservableGauge("n_eda.consumer.poll.age", {
        description: "Seconds since this partition's consumer loop last completed a poll. Lag is only trustworthy while this stays small -- a wedged loop reports frozen lag.",
        unit: "s"
    });
    const trackedKeysSize = meter.createObservableGauge("n_eda.tracked_keys.size", {
        description: "Event ids held per partition for de-duplication. Trimmed once it crosses its ceiling.",
        unit: "{key}",
        valueType: otelApi.ValueType.INT
    });
    const schedulerQueueDepth = meter.createObservableGauge("n_eda.scheduler.queue.depth", {
        description: "Work items waiting for a processor.",
        unit: "{message}",
        valueType: otelApi.ValueType.INT
    });
    const schedulerPartitionsBlocked = meter.createObservableGauge("n_eda.scheduler.partitions.blocked", {
        description: "Partition keys with an in-flight item. Work is serialized per partition key, so these are head-of-line blocked.",
        unit: "{partition}",
        valueType: otelApi.ValueType.INT
    });
    const schedulerPartitionKeysTracked = meter.createObservableGauge("n_eda.scheduler.partition_keys.tracked", {
        description: "Partition keys with an allocated queue. Only pruned hourly, so sustained growth indicates a leak.",
        unit: "{partition}",
        valueType: otelApi.ValueType.INT
    });
    const schedulerProcessorsAvailable = meter.createObservableGauge("n_eda.scheduler.processors.available", {
        description: "Processors idle and ready for work.",
        unit: "{processor}",
        valueType: otelApi.ValueType.INT
    });
    // Registered here rather than by Broker/Monitor so callbacks and instruments always
    // share a lifetime. Instruments are rebuilt when provider identity changes, and a
    // callback registered externally against the old instrument would be orphaned.
    meter.addBatchObservableCallback((result) => {
        const now = Date.now();
        for (const source of _sources) {
            // One misbehaving source must not poison the whole collection cycle.
            try {
                for (const [partition, indexes] of source.partitionMetrics) {
                    const attributes = {
                        [ATTR_MESSAGING_SYSTEM]: MESSAGING_SYSTEM,
                        [ATTR_MESSAGING_DESTINATION_NAME]: source.topicName,
                        [ATTR_MESSAGING_DESTINATION_PARTITION_ID]: partition.toString(),
                        [ATTR_MESSAGING_CONSUMER_GROUP_NAME]: source.consumerGroupId
                    };
                    result.observe(partitionWriteIndex, indexes.writeIndex, attributes);
                    result.observe(partitionReadIndex, indexes.readIndex, attributes);
                    result.observe(partitionLag, indexes.writeIndex - indexes.readIndex, attributes);
                    result.observe(consumerPollAge, (now - indexes.lastPolledAt) / 1000, attributes);
                    const trackedKeyCount = source.trackedKeyCounts.get(partition);
                    if (trackedKeyCount != null)
                        result.observe(trackedKeysSize, trackedKeyCount, attributes);
                }
                // Scheduler state is per topic, not per partition -- one scheduler serves all
                // of a topic's partitions.
                const topicAttributes = {
                    [ATTR_MESSAGING_SYSTEM]: MESSAGING_SYSTEM,
                    [ATTR_MESSAGING_DESTINATION_NAME]: source.topicName,
                    [ATTR_MESSAGING_CONSUMER_GROUP_NAME]: source.consumerGroupId
                };
                const schedulerMetrics = source.schedulerMetrics;
                result.observe(schedulerQueueDepth, schedulerMetrics.queueDepth, topicAttributes);
                result.observe(schedulerPartitionsBlocked, schedulerMetrics.blockedPartitionKeys, topicAttributes);
                result.observe(schedulerPartitionKeysTracked, schedulerMetrics.trackedPartitionKeys, topicAttributes);
                result.observe(schedulerProcessorsAvailable, schedulerMetrics.availableProcessors, topicAttributes);
            }
            catch (error) {
                console.error(error);
            }
        }
    }, [
        partitionWriteIndex, partitionReadIndex, partitionLag, consumerPollAge, trackedKeysSize,
        schedulerQueueDepth, schedulerPartitionsBlocked, schedulerPartitionKeysTracked,
        schedulerProcessorsAvailable
    ]);
    return {
        sentMessages: meter.createCounter(METRIC_MESSAGING_CLIENT_SENT_MESSAGES, {
            description: "Number of events published.",
            unit: "{message}",
            valueType: otelApi.ValueType.INT
        }),
        consumedMessages: meter.createCounter(METRIC_MESSAGING_CLIENT_CONSUMED_MESSAGES, {
            description: "Number of events read off a topic.",
            unit: "{message}",
            valueType: otelApi.ValueType.INT
        }),
        clientOperationDuration: meter.createHistogram(METRIC_MESSAGING_CLIENT_OPERATION_DURATION, {
            description: "Duration of a publish or receive operation.",
            unit: "s",
            advice: { explicitBucketBoundaries: _latencyBucketsSeconds }
        }),
        processDuration: meter.createHistogram(METRIC_MESSAGING_PROCESS_DURATION, {
            description: "End-to-end duration of processing an event, including all retry attempts and their backoff.",
            unit: "s",
            advice: { explicitBucketBoundaries: _processBucketsSeconds }
        }),
        handlerDuration: meter.createHistogram("n_eda.event.handler.duration", {
            description: "Duration of a single event handler invocation, uncontaminated by retry backoff.",
            unit: "s",
            advice: { explicitBucketBoundaries: _latencyBucketsSeconds }
        }),
        processAttempts: meter.createCounter("n_eda.event.process.attempts", {
            description: "Event handler invocations by outcome.",
            unit: "{attempt}",
            valueType: otelApi.ValueType.INT
        }),
        eventDropped: meter.createCounter("n_eda.event.dropped", {
            description: "Events permanently lost. There is no dead letter queue, so this is the only signal for these paths.",
            unit: "{event}",
            valueType: otelApi.ValueType.INT
        }),
        eventSkipped: meter.createCounter("n_eda.event.skipped", {
            description: "Events intentionally not processed -- deduplicated, unregistered, or cleared.",
            unit: "{event}",
            valueType: otelApi.ValueType.INT
        }),
        consumerReadAttempts: meter.createHistogram("n_eda.consumer.read.attempts", {
            description: "Reads needed to fetch one event blob. Values above 1 mean the producer/consumer race is being hit; the cap is 200 attempts over ~42 seconds.",
            unit: "{attempt}",
            valueType: otelApi.ValueType.INT,
            advice: { explicitBucketBoundaries: _readAttemptBuckets }
        }),
        consumerBatchSize: meter.createHistogram("n_eda.consumer.batch.size", {
            description: "Event blobs fetched per poll. Saturates at 49.",
            unit: "{message}",
            valueType: otelApi.ValueType.INT,
            advice: { explicitBucketBoundaries: _batchSizeBuckets }
        }),
        consumerLoopErrors: meter.createCounter("n_eda.consumer.loop.errors", {
            description: "Errors caught by the consumer loop, including Redis connection failures that are otherwise swallowed.",
            unit: "{error}",
            valueType: otelApi.ValueType.INT
        }),
        redisCommandDuration: meter.createHistogram("n_eda.redis.command.duration", {
            description: "Duration of a Redis command issued by this framework.",
            unit: "s",
            advice: { explicitBucketBoundaries: _redisBucketsSeconds }
        }),
        schedulerWaitDuration: meter.createHistogram("n_eda.scheduler.wait.duration", {
            description: "Time an event spent queued before a processor picked it up. Work is serialized per partition key, so this is the head-of-line blocking signal.",
            unit: "s",
            advice: { explicitBucketBoundaries: _schedulerWaitBucketsSeconds }
        }),
        redisPipelineErrors: meter.createCounter("n_eda.redis.pipeline.errors", {
            description: "Per-command failures inside a Redis pipeline. These do not reject the pipeline promise and were previously silent.",
            unit: "{error}",
            valueType: otelApi.ValueType.INT
        }),
        payloadSize: meter.createHistogram("n_eda.event.payload.size", {
            description: "Compressed size of an event batch as stored in Redis.",
            unit: "By",
            valueType: otelApi.ValueType.INT,
            advice: { explicitBucketBoundaries: _payloadSizeBuckets }
        }),
        compressionDuration: meter.createHistogram("n_eda.event.compression.duration", {
            description: "Time spent deflating or inflating an event batch. These run on the libuv threadpool.",
            unit: "s",
            advice: { explicitBucketBoundaries: _latencyBucketsSeconds }
        }),
        batchMessageCount: meter.createHistogram("n_eda.event.batch.message_count", {
            description: "Events per batch. The partition indexes count batches, so this is the multiplier between batch lag and event backlog.",
            unit: "{message}",
            valueType: otelApi.ValueType.INT,
            advice: { explicitBucketBoundaries: _batchMessageCountBuckets }
        }),
        observerLookupDuration: meter.createHistogram("n_eda.observer.subscriber_lookup.duration", {
            description: "Time to resolve an observable's subscribers. Runs serially per event per publish, so a known hot spot.",
            unit: "s",
            advice: { explicitBucketBoundaries: _latencyBucketsSeconds }
        }),
        observerSubscribers: meter.createHistogram("n_eda.observer.subscribers", {
            description: "Subscribers found for an observable.",
            unit: "{subscriber}",
            valueType: otelApi.ValueType.INT
        }),
        proxyDuration: meter.createHistogram("n_eda.proxy.duration", {
            description: "Duration of the remote hop when event handling is proxied to Lambda, RPC or gRPC.",
            unit: "s",
            advice: { explicitBucketBoundaries: _processBucketsSeconds }
        })
    };
}
//# sourceMappingURL=metrics.js.map