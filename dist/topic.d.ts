import { Duration } from "@nivinjoseph/n-util";
/**
 * A named, partitioned event stream, and the unit of configuration for both publishing and consuming.
 *
 * RULE: a topic is **publish-only by default** — `publishOnly` starts `true`. A service that registers a
 * topic but forgets `.subscribe()` will start cleanly, publish correctly, and silently never consume
 * anything. This is the most common configuration mistake with n-eda.
 *
 * Contract: register topics with `EdaManager.registerTopics(...)` before `bootstrap()`. Topic names must be
 * unique per manager (compared case-insensitively), and the string passed to `EventBus.publish` must match
 * a registered name **exactly** — that lookup is case-sensitive.
 *
 * Note: `numPartitions` is effectively immutable once events are in flight. Partition assignment is
 * `murmurhash3 x86 hash32(partitionKey) % numPartitions`, so changing the count rehashes every key, breaks
 * per-key ordering across the change, and strands events in partitions nobody reads.
 *
 * @example
 * ```typescript
 * // consumed by this service
 * const orders = new Topic("orders", Duration.fromHours(4), 100).subscribe();
 *
 * // published to but not consumed here — forcePublish is required or nothing is written
 * const audit = new Topic("audit", Duration.fromHours(4), 25).forcePublish();
 *
 * // one replica of a scaled-out consumer group
 * const shard = new Topic("orders", Duration.fromHours(4), 100).subscribe().configurePartitionAffinity("0-49");
 * ```
 */
export declare class Topic {
    private readonly _name;
    private readonly _ttlMinutes;
    private readonly _numPartitions;
    private _isForce;
    private _isFlush;
    private _publishOnly;
    private _partitionAffinity;
    private _isDisabled;
    /** The topic name, trimmed. Used verbatim as the Redis key component and the `publish` target. */
    get name(): string;
    /** Event payload retention, in whole minutes. See the constructor's rounding caveat. */
    get ttlMinutes(): number;
    /** Number of partitions. Caps consumption concurrency for this topic and fixes the hash space. */
    get numPartitions(): number;
    /** `true` unless {@link Topic.subscribe} was called. When `true`, no consumers are created. */
    get publishOnly(): boolean;
    /** The partitions this process owns, or `null` to own all of them. Set by {@link Topic.configurePartitionAffinity}. */
    get partitionAffinity(): ReadonlyArray<number> | null;
    /** When `true`, neither producers nor consumers are created for this topic. */
    get isDisabled(): boolean;
    /** When `true`, events publish even without a locally registered handler. See {@link Topic.forcePublish}. */
    get isForce(): boolean;
    /** When `true`, consumers drain and discard without dispatching. See {@link Topic.flushConsume}. */
    get isFlush(): boolean;
    /**
     * Creates a topic. All three arguments are required.
     *
     * RULE: `ttlDuration` is stored as **whole minutes** (`toMinutes(true)`, which rounds). A sub-minute
     * duration such as `Duration.fromSeconds(20)` rounds to `0`, producing `SETEX key 0` and a Redis
     * `ERR invalid expire time` on every publish. Use one minute or more.
     *
     * Note: the TTL applies only to event payload keys. The write index, read index, and tracked-keys list
     * never expire, so Redis should run with `maxmemory-policy noeviction`.
     *
     * @param name - the topic name; trimmed, and unique per manager (case-insensitively)
     * @param ttlDuration - how long event payloads are retained; a `Duration` from `@nivinjoseph/n-util`
     * @param numPartitions - partition count, must be greater than 0
     * @throws if `name` is missing or not a string, if `ttlDuration` is missing, or if `numPartitions` is
     * not a number greater than 0
     */
    constructor(name: string, ttlDuration: Duration, numPartitions: number);
    /**
     * Opts this process in to consuming the topic, clearing the default `publishOnly` flag.
     *
     * RULE: without this call no consumers are created for the topic — the service publishes correctly and
     * never receives anything. Call it on every topic this service is meant to consume.
     *
     * @returns this topic, for chaining
     */
    subscribe(): Topic;
    /**
     * Publishes events to this topic even when the publishing process has no registered handler for them.
     *
     * Contract: `RedisEventBus.publish` normally writes only events whose `name` appears in the publishing
     * manager's `eventMap`, and silently drops the rest. A dedicated publisher service — one that emits
     * events it never consumes — therefore writes nothing at all until this is set.
     *
     * Note: this also matters for the distributed observer, whose fan-out is skipped when the normal
     * partition-mapping step produced no events.
     *
     * @returns this topic, for chaining
     */
    forcePublish(): Topic;
    /**
     * Drains the topic without dispatching: consumers advance the read index and delete the payload keys,
     * and no handler ever runs.
     *
     * Note: this is a recovery tool for abandoning a backlog you do not intend to process. Every event
     * skipped this way is permanently lost.
     *
     * @returns this topic, for chaining
     */
    flushConsume(): Topic;
    /**
     * Restricts this process to consuming only a contiguous range of the topic's partitions.
     *
     * RULE: this is the **only** mechanism for scaling a consumer group past one replica. n-eda has no
     * rebalancing, ownership lease, or heartbeat — every subscribing process otherwise creates a consumer
     * for every partition. Two replicas sharing a `consumerGroupId` without disjoint affinity read the same
     * window and both dispatch, producing genuine duplicate processing. Assign non-overlapping ranges that
     * together cover `[0, numPartitions - 1]`.
     *
     * @param partitionAffinity - a range in the format `` `${lower}-${upper}` ``. Both bounds are
     * **inclusive** and must fall within `[0, numPartitions - 1]`, with `upper >= lower`.
     * @returns this topic, for chaining
     * @throws if the string is not two parseable numbers separated by `-`
     * @throws `ArgumentException` if either bound is out of range or the range is inverted
     *
     * @example
     * ```typescript
     * // replica A
     * new Topic("orders", Duration.fromHours(4), 100).subscribe().configurePartitionAffinity("0-49");
     * // replica B
     * new Topic("orders", Duration.fromHours(4), 100).subscribe().configurePartitionAffinity("50-99");
     * ```
     */
    configurePartitionAffinity(partitionAffinity: `${number}-${number}`): Topic;
    /**
     * Turns the topic off entirely: no producers and no consumers are created for it.
     *
     * Note: the topic still counts toward `bootstrap()`'s "at least one topic registered" requirement, and
     * publishing to it is still accepted by the guard in `RedisEventBus.publish` — the events simply go
     * nowhere. Useful for switching a topic off by configuration without deleting the registration.
     *
     * @returns this topic, for chaining
     */
    disable(): Topic;
}
/**
 * Per-partition throughput and lag figures reported by consumers to the `Broker` at half the configured
 * metrics interval, and logged by the `MetricsReporter`.
 *
 * RULE: the rates are normalized per minute, not raw deltas between samples. The reporter logs on its own
 * timer, so it will re-log an entry that no consumer has refreshed since the previous tick; a rate survives
 * that re-logging unchanged, whereas a raw delta would read as if the events had moved a second time.
 * Compare `sampledAt` against the log line's own time to tell a fresh entry from a stale one.
 *
 * Note: internal telemetry type; not exported from the barrel.
 */
export interface TopicPartitionMetrics {
    /** `writeIndex - readIndex` — how many publish batches this partition is behind. */
    lag: number;
    /** The producer's current slot counter for the partition. */
    writeIndex: number;
    /** This consumer group's current offset into the partition. */
    readIndex: number;
    /**
     * Batches written per minute, derived from successive write-index samples. `0` when there is no usable
     * baseline: a partition's first report, or an index that regressed (Redis flush/eviction). Carries two
     * decimals, so a topic doing tens of events per hour still reports a non-zero rate instead of flooring
     * to `0` on the dashboard.
     */
    productionRate: number;
    /** Batches consumed per minute, derived from successive read-index samples. `0` when there is no usable baseline. */
    consumptionRate: number;
    /**
     * Epoch milliseconds of the report that produced this entry — how fresh these figures are.
     *
     * RULE: not named `timestamp`. These figures are logged for ingestion by Datadog, where `timestamp` is a
     * reserved attribute whose date remapper would treat it as the log event's own time.
     */
    sampledAt: number;
}
//# sourceMappingURL=topic.d.ts.map