import { Disposable } from "@nivinjoseph/n-util";
import { Redis } from "ioredis";
import { EdaManager } from "../eda-manager.js";
import { Broker } from "./broker.js";
/**
 * Reads one partition of one topic for one consumer group, and routes what it finds to the broker.
 *
 * The loop: `MGET` the write and read indexes; if caught up, sleep on a cancellable delay that the `Monitor`
 * interrupts on a pub/sub doorbell; otherwise `MGET` a window of at most 50 slots, inflate and deserialize
 * each batch, skip ids already in the dedupe set, route the rest concurrently, then advance the read index.
 *
 * Contract: the read index advances only after every routed event settles, so a crash mid-batch replays that
 * batch. Deduplication is a rolling window of the last 1000 event ids per (topic, partition, group),
 * persisted as a Redis list and reloaded at startup. Events whose handler registration is missing are marked
 * processed and skipped — deliberate, so a rolling deployment does not stall.
 *
 * Duplicate suppression has two layers. An id that has finished is in the tracked set; an id that has been
 * dispatched and not yet finished is in the in-flight map. A copy of either is not dispatched again, which
 * covers a second copy in the same read window and a window that is re-read after an error. Finished ids are
 * written to Redis as they finish, one write at a time, and once more when the loop exits — so a hard kill
 * replays only what was in flight or finished within one Redis round trip, not the whole open window.
 *
 * Note: a slot whose payload has not landed yet is retried up to 200 times (≈42 s) — this absorbs the race
 * between the producer's `INCR` and its `SETEX`, which are separate round-trips.
 */
export declare class Consumer implements Disposable {
    private readonly _edaPrefix;
    private readonly _nedaClearTrackedKeysEventName;
    private readonly _nedaDistributedObserverNotifyEventName;
    private readonly _client;
    private readonly _manager;
    private readonly _logger;
    private readonly _topic;
    private readonly _partition;
    private readonly _cleanKeys;
    private readonly _flush;
    private _isDisposed;
    private readonly _maxTrackedSize;
    private readonly _keepTrackedSize;
    private _trackedKeysArray;
    private _trackedKeysSet;
    private _keysToTrack;
    private readonly _inFlight;
    private _savePromise;
    private readonly _clearsAppliedInWindow;
    private _knownReadIndex;
    private _tracksHeldForClear;
    private _consumePromise;
    private _broker;
    private _delayCanceller;
    private _lastReportTime;
    private readonly _reportIntervalMs;
    private get _writeIndexKey();
    private get _readIndexKey();
    private get _trackedKeysKey();
    private get _fullId();
    get id(): string;
    constructor(client: Redis, manager: EdaManager, topic: string, partition: number, flush?: boolean);
    registerBroker(broker: Broker): void;
    consume(): void;
    dispose(): Promise<void>;
    awaken(): void;
    private _beginConsume;
    /**
     * The last thing the consumer does, whichever way the loop was left.
     *
     * The loop returns as soon as it notices disposal, which can be while it is still reading a window's
     * slots — before it has awaited the events it dispatched or saved any ids. Those events are still
     * running at that point, so this waits for them to settle and then writes whatever they tracked.
     * `dispose()` awaits the consume promise, so it resolves only after that write.
     */
    private _settleInFlightAndSave;
    private _runConsumeLoop;
    private _attemptRoute;
    private _fetchPartitionWriteAndConsumerPartitionReadIndexes;
    /**
     * Moves this group's read index: to `index` when given, otherwise forward by one.
     *
     * Either way `_knownReadIndex` follows, so that the next fetch does not mistake this consumer's own
     * write for someone else having moved the index.
     */
    private _incrementConsumerPartitionReadIndex;
    private _retrieveEvent;
    private _batchRetrieveEvents;
    private _clearAllEventTracking;
    private _track;
    /**
     * Writes the pending tracked ids to Redis, or joins the write that is already doing so.
     *
     * Only one write runs at a time. It loops until nothing is pending, so ids tracked while it is running
     * go out in its next `LPUSH` — at a low event rate that is one write per event, and under load the
     * writes batch themselves. Running them one at a time also keeps the list in tracking order, which the
     * trim to the newest 1000 relies on.
     */
    private _savePendingTrackedKeys;
    private _pushPendingTrackedKeys;
    private _saveTrackedKeys;
    private _purgeTrackedKeys;
    private _loadTrackedKeys;
    private _decompressEvents;
    private _removeKeys;
}
//# sourceMappingURL=consumer.d.ts.map