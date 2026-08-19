import { given } from "@nivinjoseph/n-defensive";
import { ArgumentException } from "@nivinjoseph/n-exception";
import { TypeHelper } from "@nivinjoseph/n-util";
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
// public
export class Topic {
    _name;
    _ttlMinutes;
    _numPartitions;
    _isForce = false;
    _isFlush = false;
    _publishOnly = true;
    _partitionAffinity = null;
    _isDisabled = false;
    /** The topic name, trimmed. Used verbatim as the Redis key component and the `publish` target. */
    get name() { return this._name; }
    /** Event payload retention, in whole minutes. See the constructor's rounding caveat. */
    get ttlMinutes() { return this._ttlMinutes; }
    /** Number of partitions. Caps consumption concurrency for this topic and fixes the hash space. */
    get numPartitions() { return this._numPartitions; }
    /** `true` unless {@link Topic.subscribe} was called. When `true`, no consumers are created. */
    get publishOnly() { return this._publishOnly; }
    /** The partitions this process owns, or `null` to own all of them. Set by {@link Topic.configurePartitionAffinity}. */
    get partitionAffinity() { return this._partitionAffinity; }
    /** When `true`, neither producers nor consumers are created for this topic. */
    get isDisabled() { return this._isDisabled; }
    /** When `true`, events publish even without a locally registered handler. See {@link Topic.forcePublish}. */
    get isForce() { return this._isForce; }
    /** When `true`, consumers drain and discard without dispatching. See {@link Topic.flushConsume}. */
    get isFlush() { return this._isFlush; }
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
    constructor(name, ttlDuration, numPartitions) {
        given(name, "name").ensureHasValue().ensureIsString();
        this._name = name.trim();
        given(ttlDuration, "ttlDuration").ensureHasValue();
        this._ttlMinutes = ttlDuration.toMinutes(true);
        given(numPartitions, "numPartitions").ensureHasValue().ensureIsNumber().ensure(t => t > 0);
        this._numPartitions = numPartitions;
    }
    /**
     * Opts this process in to consuming the topic, clearing the default `publishOnly` flag.
     *
     * RULE: without this call no consumers are created for the topic — the service publishes correctly and
     * never receives anything. Call it on every topic this service is meant to consume.
     *
     * @returns this topic, for chaining
     */
    subscribe() {
        this._publishOnly = false;
        return this;
    }
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
    forcePublish() {
        this._isForce = true;
        return this;
    }
    /**
     * Drains the topic without dispatching: consumers advance the read index and delete the payload keys,
     * and no handler ever runs.
     *
     * Note: this is a recovery tool for abandoning a backlog you do not intend to process. Every event
     * skipped this way is permanently lost.
     *
     * @returns this topic, for chaining
     */
    flushConsume() {
        this._isFlush = true;
        return this;
    }
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
    configurePartitionAffinity(partitionAffinity) {
        given(partitionAffinity, "partitionAffinity").ensureHasValue().ensureIsString()
            .ensure(t => t.contains("-") && t.trim().split("-").length === 2 && t.trim().split("-")
            .every(u => TypeHelper.parseNumber(u) != null), "invalid format");
        const [lower, upper] = partitionAffinity.trim().split("-").map(t => Number.parseInt(t));
        if (lower < 0 || lower >= this._numPartitions || upper < 0 || upper >= this._numPartitions || upper < lower)
            throw new ArgumentException("partitionAffinity", "invalid value");
        const partitions = new Array();
        for (let i = lower; i <= upper; i++)
            partitions.push(i);
        this._partitionAffinity = partitions;
        return this;
    }
    /**
     * Turns the topic off entirely: no producers and no consumers are created for it.
     *
     * Note: the topic still counts toward `bootstrap()`'s "at least one topic registered" requirement, and
     * publishing to it is still accepted by the guard in `RedisEventBus.publish` — the events simply go
     * nowhere. Useful for switching a topic off by configuration without deleting the registration.
     *
     * @returns this topic, for chaining
     */
    disable() {
        this._isDisabled = true;
        return this;
    }
}
//# sourceMappingURL=topic.js.map