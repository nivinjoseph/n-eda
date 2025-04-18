import { given } from "@nivinjoseph/n-defensive";
import { Delay, Deserializer, Duration, Make } from "@nivinjoseph/n-util";
// import * as Redis from "redis";
import { ApplicationException, ObjectDisposedException } from "@nivinjoseph/n-exception";
import * as otelApi from "@opentelemetry/api";
import * as semCon from "@opentelemetry/semantic-conventions";
import Zlib from "zlib";
import { EdaManager } from "../eda-manager.js";
import { EventRegistration } from "../event-registration.js";
import { Broker } from "./broker.js";
import { NedaClearTrackedKeysEvent } from "./neda-clear-tracked-keys-event.js";
import { NedaDistributedObserverNotifyEvent } from "./neda-distributed-observer-notify-event.js";
// import * as MessagePack from "msgpackr";
// import * as Snappy from "snappy";
export class Consumer {
    get _writeIndexKey() { return `${this.id}-write-index`; }
    get _readIndexKey() { return `${this._fullId}-read-index`; }
    get _trackedKeysKey() { return `${this._fullId}-tracked_keys`; }
    get _fullId() { return `${this.id}-${this._manager.consumerGroupId}`; }
    get id() { return `{${this._edaPrefix}-${this._topic}-${this._partition}}`; }
    constructor(client, manager, topic, partition, flush = false) {
        this._edaPrefix = "n-eda";
        this._nedaClearTrackedKeysEventName = NedaClearTrackedKeysEvent.getTypeName();
        this._nedaDistributedObserverNotifyEventName = NedaDistributedObserverNotifyEvent.getTypeName();
        this._isDisposed = false;
        this._maxTrackedSize = 3000;
        this._keepTrackedSize = 1000;
        this._trackedKeysArray = new Array();
        this._trackedKeysSet = new Set();
        this._keysToTrack = new Array();
        this._consumePromise = null;
        this._broker = null;
        this._delayCanceller = null;
        this._lastReportTime = 0;
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
        var _a;
        if (!this._isDisposed) {
            this._isDisposed = true;
            if (this._delayCanceller != null)
                this._delayCanceller.cancel();
            // console.warn(`Disposing consumer ${this.id}`);
        }
        return ((_a = this._consumePromise) === null || _a === void 0 ? void 0 : _a.then(() => {
            // console.warn(`Consumer disposed ${this.id}`);
        })) || Promise.resolve().then(() => {
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
        const maxReadAttempts = 50;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (this._isDisposed)
                return;
            try {
                // const writeIndex = await this._fetchPartitionWriteIndex();
                // const readIndex = await this._fetchConsumerPartitionReadIndex();
                const [writeIndex, readIndex] = await this._fetchPartitionWriteAndConsumerPartitionReadIndexes();
                const now = Date.now();
                if ((now - this._lastReportTime) > Duration.fromMinutes(1).toMilliSeconds()) {
                    this._broker.report(this._partition, writeIndex, readIndex);
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
                    upperBoundReadIndex = readIndex + maxRead - 1;
                    await this._logger.logWarning(`Event queue depth for ${this.id} is ${depth}.`);
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
                        await Delay.milliseconds(100);
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
                    for (const event of events) {
                        // const eventId = (<any>event).$id || (<any>event).id; // for compatibility with n-domain DomainEvent
                        // if (this._trackedKeysSet.has(eventId))
                        //     continue;
                        // const eventName = (<any>event).$name || (<any>event).name; // for compatibility with n-domain DomainEvent
                        const deserializedEvent = Deserializer.deserialize(event);
                        const eventId = deserializedEvent.id;
                        if (this._trackedKeysSet.has(eventId))
                            continue;
                        if (deserializedEvent.name === this._nedaClearTrackedKeysEventName) {
                            await this._logger.logWarning(`NedaClearTrackedKeysEvent (${this._fullId}) --- clearing all event tracking data`);
                            await this._clearAllEventTracking();
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
                        routed.push(this._attemptRoute(eventName, eventRegistration, item.index, item.key, eventId, event, deserializedEvent));
                    }
                }
                await Promise.all(routed);
                await this._saveTrackedKeys();
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                if (this._isDisposed)
                    return;
                await this._incrementConsumerPartitionReadIndex(upperBoundReadIndex);
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
        var _a;
        const traceData = (_a = rawEvent["$traceData"]) !== null && _a !== void 0 ? _a : {};
        const parentContext = otelApi.propagation.extract(otelApi.ROOT_CONTEXT, traceData);
        const tracer = otelApi.trace.getTracer("n-eda");
        const span = tracer.startSpan(`event.${event.name} receive`, {
            kind: otelApi.SpanKind.INTERNAL,
            attributes: {
                [semCon.SemanticAttributes.MESSAGING_SYSTEM]: "n-eda",
                [semCon.SemanticAttributes.MESSAGING_OPERATION]: "receive",
                [semCon.SemanticAttributes.MESSAGING_DESTINATION]: `${this._topic}+++${this._partition}`,
                [semCon.SemanticAttributes.MESSAGING_DESTINATION_KIND]: "topic",
                [semCon.SemanticAttributes.MESSAGING_TEMP_DESTINATION]: false,
                [semCon.SemanticAttributes.MESSAGING_PROTOCOL]: "NEDA",
                [semCon.SemanticAttributes.MESSAGE_ID]: event.id,
                [semCon.SemanticAttributes.MESSAGING_CONVERSATION_ID]: event.partitionKey
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
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                resolve(results.map(value => value != null ? JSON.parse(value) : 0));
            }).catch(e => reject(e));
        });
    }
    _incrementConsumerPartitionReadIndex(index) {
        if (index != null) {
            return new Promise((resolve, reject) => {
                this._client.set(this._readIndexKey, index.toString(), (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                }).catch(e => reject(e));
            });
        }
        return new Promise((resolve, reject) => {
            this._client.incr(this._readIndexKey, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
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
        await new Promise((resolve, reject) => {
            this._client.unlink(this._trackedKeysKey, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            }).catch(e => reject(e));
        });
        this._trackedKeysSet = new Set();
        this._trackedKeysArray = new Array();
        this._keysToTrack = new Array();
    }
    _track(eventKey) {
        this._trackedKeysSet.add(eventKey);
        this._trackedKeysArray.push(eventKey);
        this._keysToTrack.push(eventKey);
    }
    async _saveTrackedKeys() {
        if (this._keysToTrack.isNotEmpty) {
            if (this._isDisposed)
                await this._logger.logInfo(`Saving ${this._keysToTrack.length} tracked keys in ${this.id}`);
            await new Promise((resolve, reject) => {
                this._client.lpush(this._trackedKeysKey, ...this._keysToTrack, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                }).catch(e => reject(e));
            });
            if (this._isDisposed)
                await this._logger.logInfo(`Saved ${this._keysToTrack.length} tracked keys in ${this.id}`);
            this._keysToTrack = new Array();
        }
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