import { given } from "@nivinjoseph/n-defensive";
import { Delay, Deserializer, Make } from "@nivinjoseph/n-util";
// import * as Redis from "redis";
import { ApplicationException, ObjectDisposedException } from "@nivinjoseph/n-exception";
import * as otelApi from "@opentelemetry/api";
import { ATTR_MESSAGING_SYSTEM, ATTR_MESSAGING_OPERATION_TYPE, ATTR_MESSAGING_DESTINATION_NAME, ATTR_MESSAGING_DESTINATION_TEMPORARY, ATTR_MESSAGING_MESSAGE_ID, ATTR_MESSAGING_MESSAGE_CONVERSATION_ID } from "@opentelemetry/semantic-conventions/incubating";
import Zlib from "zlib";
import { EdaManager } from "../eda-manager.js";
import { EventRegistration } from "../event-registration.js";
import { Broker } from "./broker.js";
import { NedaClearTrackedKeysEvent } from "./neda-clear-tracked-keys-event.js";
import { NedaDistributedObserverNotifyEvent } from "./neda-distributed-observer-notify-event.js";
// import * as MessagePack from "msgpackr";
// import * as Snappy from "snappy";
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
export class Consumer {
    _edaPrefix = "n-eda";
    _nedaClearTrackedKeysEventName = NedaClearTrackedKeysEvent.getTypeName();
    _nedaDistributedObserverNotifyEventName = NedaDistributedObserverNotifyEvent.getTypeName();
    // private readonly _defaultDelayMS = 100;
    _client;
    _manager;
    _logger;
    _topic;
    _partition;
    _cleanKeys;
    // private readonly _trackedKeysKey: string;
    _flush;
    _isDisposed = false;
    _maxTrackedSize = 3000;
    _keepTrackedSize = 1000;
    _trackedKeysArray = new Array();
    _trackedKeysSet = new Set();
    _keysToTrack = new Array();
    // Ids that have been dispatched and have not settled yet, each with the promise of that dispatch.
    _inFlight = new Map();
    // The write of tracked ids to Redis that is currently running, if any. Only one runs at a time.
    _savePromise = null;
    // Where each NedaClearTrackedKeysEvent applied in the window currently being read sits: its slot and its
    // place within that slot. Emptied when that window completes, and whenever the read index turns out not
    // to be where this consumer left it.
    _clearsAppliedInWindow = new Set();
    // The read index as this consumer last knew it: the value it last fetched, or the one it has written
    // itself since.
    _knownReadIndex = null;
    // Ids that finished while a NedaClearTrackedKeysEvent was being applied, held back until it is done.
    // Non-null only for the duration of that clear.
    _tracksHeldForClear = null;
    _consumePromise = null;
    _broker = null;
    _delayCanceller = null;
    _lastReportTime = 0;
    // Half the MetricsReporter's logging interval, so no logged line is ever more than one report stale.
    // Immutable after bootstrap (enableMetrics throws post-bootstrap), hence computed once.
    _reportIntervalMs;
    get _writeIndexKey() { return `${this.id}-write-index`; }
    get _readIndexKey() { return `${this._fullId}-read-index`; }
    get _trackedKeysKey() { return `${this._fullId}-tracked_keys`; }
    get _fullId() { return `${this.id}-${this._manager.consumerGroupId}`; }
    get id() { return `{${this._edaPrefix}-${this._topic}-${this._partition}}`; }
    constructor(client, manager, topic, partition, flush = false) {
        given(client, "client").ensureHasValue().ensureIsObject();
        this._client = client;
        given(manager, "manager").ensureHasValue().ensureIsObject().ensureIsType(EdaManager);
        this._manager = manager;
        this._logger = this._manager.serviceLocator.resolve("Logger");
        given(topic, "topic").ensureHasValue().ensureIsString();
        this._topic = topic;
        given(partition, "partition").ensureHasValue().ensureIsNumber();
        this._partition = partition;
        this._cleanKeys = this._manager.cleanKeys;
        this._reportIntervalMs = this._manager.metricsInterval.toMilliSeconds() / 2;
        given(flush, "flush").ensureHasValue().ensureIsBoolean();
        this._flush = flush;
    }
    registerBroker(broker) {
        given(broker, "broker").ensureHasValue().ensureIsObject().ensureIsObject().ensureIsType(Broker);
        this._broker = broker;
    }
    consume() {
        if (this._isDisposed)
            throw new ObjectDisposedException("Consumer");
        given(this, "this").ensure(t => !t._consumePromise, "consumption has already commenced");
        this._consumePromise = this._beginConsume();
    }
    async dispose() {
        if (!this._isDisposed) {
            this._isDisposed = true;
            if (this._delayCanceller != null)
                this._delayCanceller.cancel();
            // console.warn(`Disposing consumer ${this.id}`);
        }
        return this._consumePromise?.then(() => {
            // console.warn(`Consumer disposed ${this.id}`);
        }) || Promise.resolve().then(() => {
            // console.warn(`Consumer disposed ${this.id}`);
        });
    }
    awaken() {
        if (this._delayCanceller != null)
            this._delayCanceller.cancel();
    }
    async _beginConsume() {
        await this._loadTrackedKeys();
        await this._logger.logInfo(`Loaded tracked keys for Consumer ${this.id} => ${this._trackedKeysSet.size}`);
        try {
            await this._runConsumeLoop();
        }
        finally {
            await this._settleInFlightAndSave();
        }
    }
    /**
     * The last thing the consumer does, whichever way the loop was left.
     *
     * The loop returns as soon as it notices disposal, which can be while it is still reading a window's
     * slots — before it has awaited the events it dispatched or saved any ids. Those events are still
     * running at that point, so this waits for them to settle and then writes whatever they tracked.
     * `dispose()` awaits the consume promise, so it resolves only after that write.
     */
    async _settleInFlightAndSave() {
        await Promise.allSettled([...this._inFlight.values()]);
        try {
            await this._saveTrackedKeys();
        }
        catch (error) {
            await this._logger.logWarning(`Failed to save tracked keys while stopping consumer ${this.id}`);
            await this._logger.logError(error);
        }
    }
    async _runConsumeLoop() {
        const maxReadAttempts = 200;
        const failedReadShortDelayMs = 100;
        const failedReadLongDelayMs = 250;
        // Deliberately decoupled from maxRead: exceeding one read batch (50) is routine catch-up and fires
        // every loop iteration, so warning at that level is noise. 500 means a backlog worth looking at.
        const depthWarningThreshold = 500;
        while (true) {
            if (this._isDisposed)
                return;
            try {
                // const writeIndex = await this._fetchPartitionWriteIndex();
                // const readIndex = await this._fetchConsumerPartitionReadIndex();
                const [writeIndex, readIndex] = await this._fetchPartitionWriteAndConsumerPartitionReadIndexes();
                // The record of applied clears is only meant for a window being read again from where this
                // consumer left it. If the read index is anywhere else it was moved by someone else — an
                // operator rewinding or skipping, or Redis being reset — so what follows is a replay or a
                // different window, and a clear found in it is to be applied.
                if (readIndex !== this._knownReadIndex) {
                    this._clearsAppliedInWindow.clear();
                    this._knownReadIndex = readIndex;
                }
                const now = Date.now();
                // report() is an in-memory map write, so the half-interval frequency costs nothing.
                if ((now - this._lastReportTime) > this._reportIntervalMs) {
                    this._broker.report(this._partition, writeIndex, readIndex, now);
                    this._lastReportTime = now;
                }
                if (readIndex >= writeIndex) {
                    this._delayCanceller = {};
                    await Delay.milliseconds(Make.randomInt(2500, 5000), this._delayCanceller);
                    // await Delay.seconds(1, this._delayCanceller);
                    continue;
                }
                const maxRead = 50;
                const depth = writeIndex - readIndex;
                const lowerBoundReadIndex = readIndex + 1;
                let upperBoundReadIndex = writeIndex;
                if (depth > maxRead) {
                    // Inclusive window [readIndex + 1, readIndex + maxRead] = exactly maxRead slots; the
                    // previous `+ maxRead - 1` read one slot short of the cap on every backlogged batch.
                    upperBoundReadIndex = readIndex + maxRead;
                    if (depth > depthWarningThreshold)
                        await this._logger.logWarning(`Event queue depth for ${this.id} (consumer ${this._manager.consumerName} [${this._manager.consumerGroupId}]) is ${depth}.`);
                }
                const eventsData = await this._batchRetrieveEvents(lowerBoundReadIndex, upperBoundReadIndex);
                if (this._flush) {
                    await this._incrementConsumerPartitionReadIndex(upperBoundReadIndex);
                    await this._removeKeys(eventsData.map(t => t.key));
                    continue;
                }
                const routed = new Array();
                const eventDataKeys = new Array();
                for (const item of eventsData) {
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    if (this._isDisposed)
                        return;
                    let eventData = item.value;
                    if (this._cleanKeys)
                        eventDataKeys.push(item.key);
                    let numReadAttempts = 1;
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    while (eventData == null && numReadAttempts < maxReadAttempts) // we need to do this to deal with race condition
                     {
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        if (this._isDisposed)
                            return;
                        await Delay.milliseconds(numReadAttempts < (maxReadAttempts / 4)
                            ? failedReadShortDelayMs
                            : failedReadLongDelayMs);
                        eventData = await this._retrieveEvent(item.key);
                        numReadAttempts++;
                    }
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    if (eventData == null) {
                        try {
                            throw new ApplicationException(`Failed to read event data after ${maxReadAttempts} read attempts => Topic=${this._topic}; Partition=${this._partition}; ReadIndex=${item.index};`);
                        }
                        catch (error) {
                            await this._logger.logError(error);
                        }
                        await this._incrementConsumerPartitionReadIndex();
                        continue;
                    }
                    const events = await this._decompressEvents(eventData);
                    for (const [position, event] of events.entries()) {
                        // const eventId = (<any>event).$id || (<any>event).id; // for compatibility with n-domain DomainEvent
                        // if (this._trackedKeysSet.has(eventId))
                        //     continue;
                        // const eventName = (<any>event).$name || (<any>event).name; // for compatibility with n-domain DomainEvent
                        const deserializedEvent = Deserializer.deserialize(event);
                        const eventId = deserializedEvent.id;
                        if (this._trackedKeysSet.has(eventId))
                            continue;
                        // Dispatched already and still running: either a second copy in this window, or
                        // this window being read again after an error. Wait on the original dispatch rather
                        // than starting another, so the read index still cannot advance past it.
                        const inFlight = this._inFlight.get(eventId);
                        if (inFlight != null) {
                            routed.push(inFlight);
                            continue;
                        }
                        if (deserializedEvent.name === this._nedaClearTrackedKeysEventName) {
                            // A clear is applied once while its window is being read. The clear event itself
                            // is never tracked, so without this a window read again after an error would
                            // apply it again and wipe the ids of events that have finished since — letting
                            // them be dispatched again. Remembered by where the clear sits rather than by
                            // its id: a re-read finds it in the same place, while a second clear is applied
                            // even if it is in the same slot or reuses the first one's id.
                            const clearPosition = `${item.index}:${position}`;
                            if (this._clearsAppliedInWindow.has(clearPosition))
                                continue;
                            await this._logger.logWarning(`NedaClearTrackedKeysEvent (${this._fullId}) --- clearing all event tracking data`);
                            await this._clearAllEventTracking();
                            this._clearsAppliedInWindow.add(clearPosition);
                            await this._logger.logWarning(`NedaClearTrackedKeysEvent (${this._fullId}) --- event tracking data cleared`);
                            continue;
                        }
                        const eventName = deserializedEvent.name;
                        let eventRegistration;
                        if (eventName === this._nedaDistributedObserverNotifyEventName) {
                            const distributedObserverEvent = deserializedEvent;
                            const observationKey = EventRegistration.generateObservationKey(distributedObserverEvent.observerTypeName, distributedObserverEvent.observedEvent.refType, distributedObserverEvent.observedEvent.name);
                            eventRegistration = this._manager.observerEventMap.get(observationKey);
                        }
                        else
                            eventRegistration = this._manager.eventMap.get(eventName);
                        if (eventRegistration == null) // Because we check event registrations on publish, if the registration is null here, then that is a consequence of rolling deployment
                         {
                            this._track(eventId);
                            continue;
                        }
                        // One chain: the promise that removes the entry is the one stored and awaited.
                        const route = this._attemptRoute(eventName, eventRegistration, item.index, item.key, eventId, event, deserializedEvent)
                            .finally(() => this._inFlight.delete(eventId));
                        // A route rejects only if `_attemptRoute` throws before its `try` — while it builds
                        // the receive span, which is where it reads `event.partitionKey` — and it does so
                        // the moment it is called. (A throw inside that `try`, such as from a custom
                        // partition key mapper, does not reject the route: it is caught there, and the
                        // event is tracked and skipped.) `Promise.all(routed)` below is what acts on a
                        // rejection, but the loop may still be reading later slots, or may throw or return
                        // before it gets there. Observing the rejection here keeps it from being reported
                        // as unhandled, which would take the whole process down; `route` itself still
                        // rejects, so the window still fails and is retried.
                        route.catch(() => { });
                        this._inFlight.set(eventId, route);
                        routed.push(route);
                    }
                }
                await Promise.all(routed);
                // Normally empty by now. It is not when this window was re-read after an error and a slot
                // holding a still-running event could no longer be read, leaving that event out of `routed`.
                await Promise.allSettled([...this._inFlight.values()]);
                await this._saveTrackedKeys();
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                if (this._isDisposed)
                    return;
                await this._incrementConsumerPartitionReadIndex(upperBoundReadIndex);
                // The window is complete, so its slots will not be re-read and its clears can be forgotten.
                // A clear replayed later, after a deliberate rewind of the read index, is applied again:
                // either because it was forgotten here, or — if its window never completed — because the
                // next fetch finds the read index somewhere other than where this consumer left it.
                this._clearsAppliedInWindow.clear();
                if (this._cleanKeys)
                    await this._removeKeys(eventDataKeys);
            }
            catch (error) {
                await this._logger.logWarning(`Error in consumer => ConsumerGroupId: ${this._manager.consumerGroupId}; Topic: ${this._topic}; Partition: ${this._partition};`);
                await this._logger.logError(error);
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                if (this._isDisposed)
                    return;
                await Delay.seconds(5);
            }
        }
    }
    async _attemptRoute(eventName, eventRegistration, eventIndex, eventKey, eventId, rawEvent, event) {
        const traceData = rawEvent["$traceData"] ?? {};
        const parentContext = otelApi.propagation.extract(otelApi.ROOT_CONTEXT, traceData);
        const tracer = otelApi.trace.getTracer("n-eda");
        const span = tracer.startSpan(`event.${event.name} receive`, {
            kind: otelApi.SpanKind.INTERNAL,
            attributes: {
                [ATTR_MESSAGING_SYSTEM]: "n-eda",
                [ATTR_MESSAGING_OPERATION_TYPE]: "receive",
                [ATTR_MESSAGING_DESTINATION_NAME]: `${this._topic}+++${this._partition}`,
                [ATTR_MESSAGING_DESTINATION_TEMPORARY]: false,
                [ATTR_MESSAGING_MESSAGE_ID]: event.id,
                [ATTR_MESSAGING_MESSAGE_CONVERSATION_ID]: event.partitionKey
            }
        }, parentContext);
        // otelApi.trace.setSpan(otelApi.context.active(), span);
        // traceData = {};
        // otelApi.propagation.inject(otelApi.trace.setSpan(otelApi.context.active(), span), traceData);
        // (<any>rawEvent)["$traceData"] = traceData;
        let brokerDisposed = false;
        try {
            await otelApi.context.with(otelApi.trace.setSpan(otelApi.context.active(), span), async () => {
                await this._broker.route({
                    consumerId: this.id,
                    topic: this._topic,
                    partition: this._partition,
                    eventName,
                    eventRegistration,
                    eventIndex,
                    eventKey,
                    eventId,
                    rawEvent,
                    event,
                    partitionKey: this._manager.partitionKeyMapper(event),
                    span
                });
            });
        }
        catch (error) {
            span.recordException(error);
            span.setStatus({ code: otelApi.SpanStatusCode.ERROR });
            if (error instanceof ObjectDisposedException)
                brokerDisposed = true;
            // await this._logger.logWarning(`Failed to consume event of type '${eventName}' with data ${JSON.stringify(event.serialize())}`);
            // await this._logger.logError(error as Exception);
        }
        finally {
            // if (failed && this._isDisposed) // cuz it could have failed because things were disposed
            //     // eslint-disable-next-line no-unsafe-finally
            //     return;
            if (!brokerDisposed)
                this._track(eventId);
            span.end();
        }
    }
    // private _fetchPartitionWriteIndex(): Promise<number>
    // {
    //     const key = `${this._edaPrefix}-${this._topic}-${this._partition}-write-index`;
    //     return new Promise((resolve, reject) =>
    //     {
    //         this._client.get(key, (err, value) =>
    //         {
    //             if (err)
    //             {
    //                 reject(err);
    //                 return;
    //             }
    //             // console.log("fetchPartitionWriteIndex", JSON.parse(value!));
    //             resolve(value != null ? JSON.parse(value) : 0);
    //         });
    //     });
    // }
    // private _fetchConsumerPartitionReadIndex(): Promise<number>
    // {
    //     const key = `${this._edaPrefix}-${this._topic}-${this._partition}-${this._manager.consumerGroupId}-read-index`;
    //     return new Promise((resolve, reject) =>
    //     {
    //         this._client.get(key, (err, value) =>
    //         {
    //             if (err)
    //             {
    //                 reject(err);
    //                 return;
    //             }
    //             // console.log("fetchConsumerPartitionReadIndex", JSON.parse(value!));
    //             resolve(value != null ? JSON.parse(value) : 0);
    //         });
    //     });
    // }
    _fetchPartitionWriteAndConsumerPartitionReadIndexes() {
        return new Promise((resolve, reject) => {
            this._client.mget(this._writeIndexKey, this._readIndexKey, (err, results) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(results.map(value => value != null ? JSON.parse(value) : 0));
            }).catch(e => reject(e));
        });
    }
    /**
     * Moves this group's read index: to `index` when given, otherwise forward by one.
     *
     * Either way `_knownReadIndex` follows, so that the next fetch does not mistake this consumer's own
     * write for someone else having moved the index.
     */
    _incrementConsumerPartitionReadIndex(index) {
        if (index != null) {
            return new Promise((resolve, reject) => {
                this._client.set(this._readIndexKey, index.toString(), (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    this._knownReadIndex = index;
                    resolve();
                }).catch(e => reject(e));
            });
        }
        return new Promise((resolve, reject) => {
            this._client.incr(this._readIndexKey, (err, value) => {
                if (err) {
                    reject(err);
                    return;
                }
                this._knownReadIndex = value;
                resolve();
            }).catch(e => reject(e));
        });
    }
    _retrieveEvent(key) {
        return new Promise((resolve, reject) => {
            this._client.getBuffer(key, (err, value) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(value);
            }).catch(e => reject(e));
        });
    }
    _batchRetrieveEvents(lowerBoundIndex, upperBoundIndex) {
        return new Promise((resolve, reject) => {
            const keys = new Array();
            for (let i = lowerBoundIndex; i <= upperBoundIndex; i++) {
                const key = `${this.id}-${i}`;
                keys.push({ index: i, key });
            }
            this._client.mgetBuffer(...keys.map(t => t.key), (err, values) => {
                if (err) {
                    reject(err);
                    return;
                }
                const result = values.map((t, index) => ({
                    index: keys[index].index,
                    key: keys[index].key,
                    value: t
                }));
                resolve(result);
            }).catch(e => reject(e));
        });
    }
    async _clearAllEventTracking() {
        // No save may be running when the delete is sent, or it could write to the list after the list has
        // been deleted. A loop rather than a single await: while the last save is being awaited, an event
        // can finish and start the next one.
        while (this._savePromise != null)
            await this._savePromise.catch(() => { });
        // From here until the clear is done, ids that finish are held back instead of being tracked (see
        // `_track`). There is no await between the loop above and this line, nor between this line and the
        // delete being sent, so no id can be tracked, and no save can start, in between.
        this._tracksHeldForClear = new Array();
        try {
            await new Promise((resolve, reject) => {
                this._client.unlink(this._trackedKeysKey, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                }).catch(e => reject(e));
            });
            // Reset only once the delete has succeeded. If it fails, the window is read again with the
            // tracked set intact, so events that already finished in it are still recognized while the
            // clear is retried.
            this._trackedKeysSet = new Set();
            this._trackedKeysArray = new Array();
            this._keysToTrack = new Array();
        }
        finally {
            // Whether the clear went through or not, the ids that finished while it was being applied are
            // tracked now: after the reset if there was one, so memory and Redis both keep them.
            const held = this._tracksHeldForClear;
            this._tracksHeldForClear = null;
            held.forEach(t => this._track(t));
        }
    }
    _track(eventKey) {
        // A clear is being applied. An id that finishes now must not be added to a set that is about to be
        // reset, nor written to a list that is about to be, or has just been, deleted — the two would then
        // disagree about it. It is held back and tracked as soon as the clear is done.
        if (this._tracksHeldForClear != null) {
            this._tracksHeldForClear.push(eventKey);
            return;
        }
        this._trackedKeysSet.add(eventKey);
        this._trackedKeysArray.push(eventKey);
        this._keysToTrack.push(eventKey);
        // Written as soon as it is tracked rather than at the end of the window, so a hard kill loses at
        // most the ids tracked during one Redis round trip. A write that is already running picks this id
        // up on its next pass, so only start one — and log its failure once — when none is. A failure is
        // only logged: the ids stay pending and the end-of-window save retries them, failing the window if
        // it cannot write them either. Nothing awaits this promise, so the logging is itself guarded: a
        // logger that rejects or throws would otherwise surface as an unhandled rejection and end the process.
        if (this._savePromise == null)
            this._savePendingTrackedKeys()
                .catch(e => this._logger.logError(e))
                .catch(() => { });
    }
    /**
     * Writes the pending tracked ids to Redis, or joins the write that is already doing so.
     *
     * Only one write runs at a time. It loops until nothing is pending, so ids tracked while it is running
     * go out in its next `LPUSH` — at a low event rate that is one write per event, and under load the
     * writes batch themselves. Running them one at a time also keeps the list in tracking order, which the
     * trim to the newest 1000 relies on.
     */
    _savePendingTrackedKeys() {
        if (this._savePromise != null)
            return this._savePromise;
        if (this._keysToTrack.isEmpty)
            return Promise.resolve();
        this._savePromise = this._pushPendingTrackedKeys();
        return this._savePromise;
    }
    async _pushPendingTrackedKeys() {
        try {
            while (this._keysToTrack.isNotEmpty) {
                // Taken before the await, so ids tracked while this write is in flight are neither sent
                // twice nor discarded when it completes.
                const keys = this._keysToTrack;
                this._keysToTrack = new Array();
                try {
                    await new Promise((resolve, reject) => {
                        this._client.lpush(this._trackedKeysKey, ...keys, (err) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            resolve();
                        }).catch(e => reject(e));
                    });
                }
                catch (error) {
                    // Put back ahead of anything tracked meanwhile, so a retry writes them in order.
                    this._keysToTrack = [...keys, ...this._keysToTrack];
                    throw error;
                }
            }
        }
        finally {
            // Cleared here, in the same step as the loop's exit check, so that an id tracked immediately
            // afterwards starts a new write instead of joining one that has already finished looking.
            this._savePromise = null;
        }
    }
    async _saveTrackedKeys() {
        // A background write may be running or may have failed and left its ids pending. Wait it out, then
        // write whatever is left; unlike the background write, a failure here propagates to the caller.
        await this._savePromise?.catch(() => { });
        // Counted after the background write has settled, so the two log lines report what this call writes.
        const numPending = this._keysToTrack.length;
        if (numPending > 0 && this._isDisposed)
            await this._logger.logInfo(`Saving ${numPending} tracked keys in ${this.id}`);
        await this._savePendingTrackedKeys();
        if (numPending > 0 && this._isDisposed)
            await this._logger.logInfo(`Saved ${numPending} tracked keys in ${this.id}`);
        if (this._isDisposed)
            return;
        if (this._trackedKeysSet.size >= this._maxTrackedSize) {
            const newTracked = this._trackedKeysArray.skip(this._maxTrackedSize - this._keepTrackedSize);
            this._trackedKeysSet = new Set(newTracked);
            this._trackedKeysArray = newTracked;
            await this._purgeTrackedKeys();
            // await Promise.all([
            //     erasedKeys.isNotEmpty ? this._removeKeys(erasedKeys) : Promise.resolve(),
            //     this._purgeTrackedKeys()
            // ]);
        }
    }
    // private async _track(eventKey: string): Promise<void>
    // {
    //     this._trackedKeysSet.add(eventKey);
    //     await this._saveTrackedKey(eventKey);
    //     if (this._trackedKeysSet.size >= 300)
    //     {
    //         const trackedKeysArray = [...this._trackedKeysSet.values()];
    //         this._trackedKeysSet = new Set<string>(trackedKeysArray.skip(200));
    //         if (this._cleanKeys)
    //         {
    //             const erasedKeys = trackedKeysArray.take(200);
    //             await this._removeKeys(erasedKeys);
    //         }
    //         await this._purgeTrackedKeys();
    //     }
    // }
    // private _saveTrackedKey(key: string): Promise<void>
    // {
    //     return new Promise((resolve, reject) =>
    //     {
    //         this._client.lpush(this._trackedKeysKey, key, (err) =>
    //         {
    //             if (err)
    //             {
    //                 reject(err);
    //                 return;
    //             }
    //             resolve();
    //         });
    //     });
    // }
    _purgeTrackedKeys() {
        return new Promise((resolve, reject) => {
            this._client.ltrim(this._trackedKeysKey, 0, this._keepTrackedSize - 1, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            }).catch(e => reject(e));
        });
    }
    // private _purgeTrackedKeys(): void
    // {
    //     this._client.ltrim(this._trackedKeysKey, 0, 1999).catch(e => this._logger.logError(e));
    // }
    _loadTrackedKeys() {
        return new Promise((resolve, reject) => {
            this._client.lrange(this._trackedKeysKey, 0, -1, (err, keys) => {
                if (err) {
                    reject(err);
                    return;
                }
                keys = keys.reverse().map(t => t.toString("utf8"));
                // console.log(keys);
                this._trackedKeysSet = new Set(keys);
                this._trackedKeysArray = keys;
                resolve();
            }).catch(e => reject(e));
        });
    }
    // private async _decompressEvent(eventData: Buffer): Promise<object>
    // { 
    //     const decompressed = await Make.callbackToPromise<Buffer>(Zlib.brotliDecompress)(eventData,
    //         { params: { [Zlib.constants.BROTLI_PARAM_MODE]: Zlib.constants.BROTLI_MODE_TEXT } });
    //     return JSON.parse(decompressed.toString("utf8"));
    // }
    // private async _decompressEvent(eventData: Buffer): Promise<object>
    // {
    //     const decompressed = await Snappy.uncompress(eventData, { asBuffer: true }) as Buffer;
    //     return MessagePack.unpack(decompressed);
    // }
    async _decompressEvents(eventData) {
        const decompressed = await Make.callbackToPromise(Zlib.inflateRaw)(eventData);
        return JSON.parse(decompressed.toString("utf8"));
    }
    async _removeKeys(keys) {
        if (keys.isEmpty)
            return;
        return new Promise((resolve, reject) => {
            this._client.unlink(...keys, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            }).catch(e => reject(e));
        });
    }
}
//# sourceMappingURL=consumer.js.map