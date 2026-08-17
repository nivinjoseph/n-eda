import { given } from "@nivinjoseph/n-defensive";
import { Delay, DelayCanceller, Deserializer, Disposable, Make } from "@nivinjoseph/n-util";
// import * as Redis from "redis";
import { ApplicationException, ObjectDisposedException } from "@nivinjoseph/n-exception";
import { Logger } from "@nivinjoseph/n-log";
import * as otelApi from "@opentelemetry/api";
import {
    ATTR_MESSAGING_SYSTEM,
    ATTR_MESSAGING_CONSUMER_GROUP_NAME,
    ATTR_MESSAGING_OPERATION_NAME,
    ATTR_MESSAGING_OPERATION_TYPE,
    ATTR_MESSAGING_DESTINATION_NAME,
    ATTR_MESSAGING_DESTINATION_TEMPORARY,
    ATTR_MESSAGING_MESSAGE_ID,
    ATTR_MESSAGING_MESSAGE_CONVERSATION_ID
} from "@opentelemetry/semantic-conventions/incubating";
import { ATTR_ERROR_TYPE } from "@opentelemetry/semantic-conventions";
import {
    ATTR_NEDA_DIRECTION,
    ATTR_NEDA_DROP_REASON,
    ATTR_NEDA_EVENT_NAME,
    ATTR_NEDA_SKIP_REASON,
    errorTypeOf,
    instruments,
    MESSAGING_SYSTEM,
    timeRedisCommand
} from "../metrics.js";
import { Redis } from "ioredis";
import Zlib from "zlib";
import { EdaEvent } from "../eda-event.js";
import { EdaManager } from "../eda-manager.js";
import { EventRegistration } from "../event-registration.js";
import { Broker } from "./broker.js";
import { NedaClearTrackedKeysEvent } from "./neda-clear-tracked-keys-event.js";
import { NedaDistributedObserverNotifyEvent } from "./neda-distributed-observer-notify-event.js";
// import * as MessagePack from "msgpackr";
// import * as Snappy from "snappy";


export class Consumer implements Disposable
{
    private readonly _edaPrefix = "n-eda";
    private readonly _nedaClearTrackedKeysEventName = (<Object>NedaClearTrackedKeysEvent).getTypeName();
    private readonly _nedaDistributedObserverNotifyEventName = (<Object>NedaDistributedObserverNotifyEvent).getTypeName();
    // private readonly _defaultDelayMS = 100;
    private readonly _client: Redis;
    private readonly _manager: EdaManager;
    private readonly _logger: Logger;
    private readonly _topic: string;
    private readonly _partition: number;
    private readonly _cleanKeys: boolean;
    // private readonly _trackedKeysKey: string;
    private readonly _flush: boolean;
    /**
     * Built once. Deliberately carries neither the partition nor the event name: partition
     * level throughput is already served exactly by the `n_eda.partition.*` observables,
     * and event name belongs only on counters, never on histograms.
     */
    private readonly _metricAttributes: otelApi.Attributes;

    private _isDisposed = false;
    private readonly _maxTrackedSize = 3000;
    private readonly _keepTrackedSize = 1000;
    private _trackedKeysArray = new Array<string>();
    private _trackedKeysSet = new Set<string>();
    private _keysToTrack = new Array<string>();

    private _consumePromise: Promise<void> | null = null;
    private _broker: Broker = null as any;
    private _delayCanceller: DelayCanceller | null = null;

    private get _writeIndexKey(): string { return `${this.id}-write-index`; }
    private get _readIndexKey(): string { return `${this._fullId}-read-index`; }
    private get _trackedKeysKey(): string { return `${this._fullId}-tracked_keys`; }

    private get _fullId(): string { return `${this.id}-${this._manager.consumerGroupId}`; }

    public get id(): string { return `{${this._edaPrefix}-${this._topic}-${this._partition}}`; }
    public get partition(): number { return this._partition; }
    public get trackedKeyCount(): number { return this._trackedKeysSet.size; }


    public constructor(client: Redis, manager: EdaManager, topic: string, partition: number, flush = false)
    {
        given(client, "client").ensureHasValue().ensureIsObject();
        this._client = client;

        given(manager, "manager").ensureHasValue().ensureIsObject().ensureIsType(EdaManager);
        this._manager = manager;

        this._logger = this._manager.serviceLocator.resolve<Logger>("Logger");

        given(topic, "topic").ensureHasValue().ensureIsString();
        this._topic = topic;

        given(partition, "partition").ensureHasValue().ensureIsNumber();
        this._partition = partition;

        this._cleanKeys = this._manager.cleanKeys;

        given(flush, "flush").ensureHasValue().ensureIsBoolean();
        this._flush = flush;

        this._metricAttributes = {
            [ATTR_MESSAGING_SYSTEM]: MESSAGING_SYSTEM,
            [ATTR_MESSAGING_OPERATION_NAME]: "receive",
            [ATTR_MESSAGING_DESTINATION_NAME]: this._topic,
            [ATTR_MESSAGING_CONSUMER_GROUP_NAME]: this._manager.consumerGroupId ?? "UNKNOWN"
        };
    }


    public registerBroker(broker: Broker): void
    {
        given(broker, "broker").ensureHasValue().ensureIsObject().ensureIsObject().ensureIsType(Broker);
        this._broker = broker;
    }

    public consume(): void
    {
        if (this._isDisposed)
            throw new ObjectDisposedException("Consumer");

        given(this, "this").ensure(t => !t._consumePromise, "consumption has already commenced");

        this._consumePromise = this._beginConsume();
    }

    public async dispose(): Promise<void>
    {
        if (!this._isDisposed)
        {
            this._isDisposed = true;

            if (this._delayCanceller != null)
                this._delayCanceller.cancel!();

            // console.warn(`Disposing consumer ${this.id}`);
        }

        return this._consumePromise?.then(() =>
        {
            // console.warn(`Consumer disposed ${this.id}`);
        }) || Promise.resolve().then(() =>
        {
            // console.warn(`Consumer disposed ${this.id}`);
        });
    }

    public awaken(): void
    {
        if (this._delayCanceller != null)
            this._delayCanceller.cancel!();
    }

    private async _beginConsume(): Promise<void>
    {
        await this._loadTrackedKeys();
        await this._logger.logInfo(`Loaded tracked keys for Consumer ${this.id} => ${this._trackedKeysSet.size}`);

        const maxReadAttempts = 200;
        const failedReadShortDelayMs = 100;
        const failedReadLongDelayMs = 250;

        while (true)
        {
            if (this._isDisposed)
                return;

            try 
            {
                // const writeIndex = await this._fetchPartitionWriteIndex();
                // const readIndex = await this._fetchConsumerPartitionReadIndex();

                const [writeIndex, readIndex] = await this._fetchPartitionWriteAndConsumerPartitionReadIndexes();
                
                // Reported on every tick rather than once a minute: the broker just mutates
                // an in-memory entry, and the metrics collection cycle runs on its own
                // cadence, so a stale sample would read as frozen lag.
                this._broker.report(this._partition, writeIndex, readIndex, Date.now());

                if (readIndex >= writeIndex)
                {
                    this._delayCanceller = {};
                    await Delay.milliseconds(Make.randomInt(2500, 5000), this._delayCanceller);
                    // await Delay.seconds(1, this._delayCanceller);
                    continue;
                }

                const maxRead = 50;
                const depth = writeIndex - readIndex;
                const lowerBoundReadIndex = readIndex + 1;
                let upperBoundReadIndex = writeIndex;
                if (depth > maxRead)
                {
                    upperBoundReadIndex = readIndex + maxRead - 1;
                    await this._logger.logWarning(`Event queue depth for ${this.id} is ${depth}.`);
                }

                instruments().consumerBatchSize
                    .record(upperBoundReadIndex - lowerBoundReadIndex + 1, this._metricAttributes);

                const receiveStartedAt = performance.now();
                const eventsData = await this._batchRetrieveEvents(
                    lowerBoundReadIndex, upperBoundReadIndex);
                instruments().clientOperationDuration
                    .record((performance.now() - receiveStartedAt) / 1000, this._metricAttributes);

                if (this._flush)
                {
                    await this._incrementConsumerPartitionReadIndex(upperBoundReadIndex);
                    await this._removeKeys(eventsData.map(t => t.key));
                    continue;
                }

                const routed = new Array<Promise<void>>();
                const eventDataKeys = new Array<string>();

                for (const item of eventsData)
                {
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

                        await Delay.milliseconds(
                            numReadAttempts < (maxReadAttempts / 4)
                                ? failedReadShortDelayMs
                                : failedReadLongDelayMs
                        );

                        eventData = await this._retrieveEvent(item.key);
                        numReadAttempts++;
                    }

                    // Anything above 1 means the producer/consumer race is being hit. Capped
                    // at 200 attempts, which is ~42 seconds of stalling on a single key.
                    instruments().consumerReadAttempts.record(numReadAttempts, this._metricAttributes);

                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    if (eventData == null)
                    {
                        // The read index advances below, so whatever was at this index is gone
                        // for good. There is no dead letter queue, so this counter is the only
                        // signal for it.
                        instruments().eventDropped.add(1, {
                            ...this._metricAttributes,
                            [ATTR_NEDA_DROP_REASON]: "read_failed"
                        });

                        try
                        {
                            throw new ApplicationException(`Failed to read event data after ${maxReadAttempts} read attempts => Topic=${this._topic}; Partition=${this._partition}; ReadIndex=${item.index};`);
                        }
                        catch (error: any)
                        {
                            await this._logger.logError(error);
                        }

                        await this._incrementConsumerPartitionReadIndex();
                        continue;
                    }

                    const events = await this._decompressEvents(eventData);
                    for (const event of events)
                    {
                        // const eventId = (<any>event).$id || (<any>event).id; // for compatibility with n-domain DomainEvent
                        // if (this._trackedKeysSet.has(eventId))
                        //     continue;

                        // const eventName = (<any>event).$name || (<any>event).name; // for compatibility with n-domain DomainEvent
                        const deserializedEvent = Deserializer.deserialize<EdaEvent>(event);

                        // Event name is safe on a counter -- it is one datapoint per series,
                        // with no bucket multiplier, and "which event type?" is the first
                        // question asked of every one of these.
                        instruments().consumedMessages.add(1, {
                            ...this._metricAttributes,
                            [ATTR_NEDA_EVENT_NAME]: deserializedEvent.name
                        });

                        const eventId = deserializedEvent.id;
                        if (this._trackedKeysSet.has(eventId))
                        {
                            instruments().eventSkipped.add(1, {
                                ...this._metricAttributes,
                                [ATTR_NEDA_EVENT_NAME]: deserializedEvent.name,
                                [ATTR_NEDA_SKIP_REASON]: "duplicate"
                            });
                            continue;
                        }

                        if (deserializedEvent.name === this._nedaClearTrackedKeysEventName)
                        {
                            instruments().eventSkipped.add(1, {
                                ...this._metricAttributes,
                                [ATTR_NEDA_EVENT_NAME]: deserializedEvent.name,
                                [ATTR_NEDA_SKIP_REASON]: "tracked_keys_cleared"
                            });

                            await this._logger.logWarning(`NedaClearTrackedKeysEvent (${this._fullId}) --- clearing all event tracking data`);
                            await this._clearAllEventTracking();
                            await this._logger.logWarning(`NedaClearTrackedKeysEvent (${this._fullId}) --- event tracking data cleared`);
                            continue;
                        }

                        const eventName = deserializedEvent.name;
                        let eventRegistration;

                        if (eventName === this._nedaDistributedObserverNotifyEventName)
                        {
                            const distributedObserverEvent = deserializedEvent as NedaDistributedObserverNotifyEvent;
                            const observationKey = EventRegistration.generateObservationKey(
                                distributedObserverEvent.observerTypeName,
                                distributedObserverEvent.observedEvent.refType,
                                distributedObserverEvent.observedEvent.name
                            );
                            eventRegistration = this._manager.observerEventMap.get(observationKey);
                        }
                        else
                            eventRegistration = this._manager.eventMap.get(eventName);

                        if (eventRegistration == null) // Because we check event registrations on publish, if the registration is null here, then that is a consequence of rolling deployment
                        {
                            instruments().eventSkipped.add(1, {
                                ...this._metricAttributes,
                                [ATTR_NEDA_EVENT_NAME]: eventName,
                                [ATTR_NEDA_SKIP_REASON]: "no_registration"
                            });

                            this._track(eventId);
                            continue;
                        }

                        routed.push(
                            this._attemptRoute(
                                eventName, eventRegistration, item.index,
                                item.key, eventId, event, deserializedEvent));
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
            catch (error: any)
            {
                // This catch swallows everything, including Redis connection failures, then
                // sleeps and loops. Without this counter a consumer can be wedged in a tight
                // failure cycle with nothing but log lines to show for it.
                instruments().consumerLoopErrors.add(1, {
                    ...this._metricAttributes,
                    [ATTR_ERROR_TYPE]: errorTypeOf(error)
                });

                await this._logger.logWarning(`Error in consumer => ConsumerGroupId: ${this._manager.consumerGroupId}; Topic: ${this._topic}; Partition: ${this._partition};`);
                await this._logger.logError(error);
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                if (this._isDisposed)
                    return;
                await Delay.seconds(5);
            }
        }
    }

    private async _attemptRoute(eventName: string, eventRegistration: EventRegistration,
        eventIndex: number, eventKey: string, eventId: string, rawEvent: object, event: EdaEvent): Promise<void>
    {
        const traceData = (<any>rawEvent)["$traceData"] ?? {};
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
        try 
        {
            await otelApi.context.with(otelApi.trace.setSpan(otelApi.context.active(), span), async () =>
            {
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
        catch (error)
        {
            span.recordException(error as Error);
            span.setStatus({ code: otelApi.SpanStatusCode.ERROR });

            if (error instanceof ObjectDisposedException)
                brokerDisposed = true;
            // await this._logger.logWarning(`Failed to consume event of type '${eventName}' with data ${JSON.stringify(event.serialize())}`);
            // await this._logger.logError(error as Exception);
        }
        finally
        {
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

    private _fetchPartitionWriteAndConsumerPartitionReadIndexes(): Promise<Array<number>>
    {
        return timeRedisCommand("MGET", "consumer", () => new Promise<Array<number>>((resolve, reject) =>
        {
            this._client.mget(this._writeIndexKey, this._readIndexKey, (err, results) =>
            {
                if (err)
                {
                    reject(err);
                    return;
                }

                resolve(results!.map(value => value != null ? JSON.parse(value) as number : 0));
            }).catch(e => reject(e));
        }));
    }

    private _incrementConsumerPartitionReadIndex(index?: number): Promise<void>
    {
        if (index != null)
        {
            return timeRedisCommand("SET", "consumer", () => new Promise<void>((resolve, reject) =>
            {
                this._client.set(this._readIndexKey, index.toString(), (err) =>
                {
                    if (err)
                    {
                        reject(err);
                        return;
                    }

                    resolve();
                }).catch(e => reject(e));
            }));
        }

        return timeRedisCommand("INCR", "consumer", () => new Promise<void>((resolve, reject) =>
        {
            this._client.incr(this._readIndexKey, (err) =>
            {
                if (err)
                {
                    reject(err);
                    return;
                }

                resolve();
            }).catch(e => reject(e));
        }));
    }

    private _retrieveEvent(key: string): Promise<Buffer>
    {
        return timeRedisCommand("GETBUFFER", "consumer", () => new Promise<Buffer>((resolve, reject) =>
        {
            this._client.getBuffer(key, (err, value) =>
            {
                if (err)
                {
                    reject(err);
                    return;
                }

                resolve(value!);
            }).catch(e => reject(e));
        }));
    }

    private _batchRetrieveEvents(lowerBoundIndex: number, upperBoundIndex: number)
        : Promise<Array<{ index: number; key: string; value: Buffer; }>>
    {
        return timeRedisCommand("MGETBUFFER", "consumer", () => new Promise<Array<{ index: number; key: string; value: Buffer; }>>((resolve, reject) =>
        {
            const keys = new Array<{ index: number; key: string; }>();
            for (let i = lowerBoundIndex; i <= upperBoundIndex; i++)
            {
                const key = `${this.id}-${i}`;
                keys.push({ index: i, key });
            }

            this._client.mgetBuffer(...keys.map(t => t.key),
                (err, values) =>
                {
                    if (err)
                    {
                        reject(err);
                        return;
                    }

                    const result = values!.map((t, index) => ({
                        index: keys[index].index,
                        key: keys[index].key,
                        value: t!
                    }));

                    resolve(result);
                }).catch(e => reject(e));
        }));
    }

    private async _clearAllEventTracking(): Promise<void>
    {
        await timeRedisCommand("UNLINK_TRACKED", "consumer", () => new Promise<void>((resolve, reject) =>
        {
            this._client.unlink(this._trackedKeysKey, (err) =>
            {
                if (err)
                {
                    reject(err);
                    return;
                }

                resolve();
            }).catch(e => reject(e));
        }));


        this._trackedKeysSet = new Set<string>();
        this._trackedKeysArray = new Array<string>();
        this._keysToTrack = new Array<string>();
    }

    private _track(eventKey: string): void
    {
        this._trackedKeysSet.add(eventKey);
        this._trackedKeysArray.push(eventKey);
        this._keysToTrack.push(eventKey);
    }

    private async _saveTrackedKeys(): Promise<void>
    {
        if (this._keysToTrack.isNotEmpty)
        {
            if (this._isDisposed)
                await this._logger.logInfo(`Saving ${this._keysToTrack.length} tracked keys in ${this.id}`);

            await timeRedisCommand("LPUSH", "consumer", () => new Promise<void>((resolve, reject) =>
            {
                this._client.lpush(this._trackedKeysKey, ...this._keysToTrack, (err) =>
                {
                    if (err)
                    {
                        reject(err);
                        return;
                    }

                    resolve();
                }).catch(e => reject(e));
            }));

            if (this._isDisposed)
                await this._logger.logInfo(`Saved ${this._keysToTrack.length} tracked keys in ${this.id}`);

            this._keysToTrack = new Array<string>();
        }

        if (this._isDisposed)
            return;

        if (this._trackedKeysSet.size >= this._maxTrackedSize)
        {
            const newTracked = this._trackedKeysArray.skip(this._maxTrackedSize - this._keepTrackedSize);

            this._trackedKeysSet = new Set<string>(newTracked);
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

    private _purgeTrackedKeys(): Promise<void>
    {
        return timeRedisCommand("LTRIM", "consumer", () => new Promise<void>((resolve, reject) =>
        {
            this._client.ltrim(this._trackedKeysKey, 0, this._keepTrackedSize - 1, (err) =>
            {
                if (err)
                {
                    reject(err);
                    return;
                }

                resolve();
            }).catch(e => reject(e));
        }));
    }

    // private _purgeTrackedKeys(): void
    // {
    //     this._client.ltrim(this._trackedKeysKey, 0, 1999).catch(e => this._logger.logError(e));
    // }

    private _loadTrackedKeys(): Promise<void>
    {
        return timeRedisCommand("LRANGE", "consumer", () => new Promise<void>((resolve, reject) =>
        {
            this._client.lrange(this._trackedKeysKey, 0, -1, (err, keys) =>
            {
                if (err)
                {
                    reject(err);
                    return;
                }

                keys = keys!.reverse().map(t => (t as unknown as Buffer).toString("utf8"));

                // console.log(keys);

                this._trackedKeysSet = new Set<string>(keys);
                this._trackedKeysArray = keys;

                resolve();
            }).catch(e => reject(e));
        }));
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

    private async _decompressEvents(eventData: Buffer): Promise<Array<object>>
    {
        instruments().payloadSize.record(eventData.length, {
            [ATTR_MESSAGING_SYSTEM]: MESSAGING_SYSTEM,
            [ATTR_MESSAGING_DESTINATION_NAME]: this._topic,
            [ATTR_NEDA_DIRECTION]: "consume"
        });

        const startedAt = performance.now();
        try
        {
            const decompressed = await Make.callbackToPromise<Buffer>(Zlib.inflateRaw)(eventData);

            return JSON.parse(decompressed.toString("utf8")) as Array<object>;
        }
        finally
        {
            instruments().compressionDuration.record((performance.now() - startedAt) / 1000, {
                [ATTR_MESSAGING_SYSTEM]: MESSAGING_SYSTEM,
                [ATTR_NEDA_DIRECTION]: "consume"
            });
        }
    }

    private async _removeKeys(keys: ReadonlyArray<string>): Promise<void>
    {
        if (keys.isEmpty)
            return;

        return timeRedisCommand("UNLINK", "consumer", () => new Promise<void>((resolve, reject) =>
        {
            this._client.unlink(...keys, (err) =>
            {
                if (err)
                {
                    reject(err);
                    return;
                }

                resolve();
            }).catch(e => reject(e));
        }));
    }

    // private _removeKeys(keys: ReadonlyArray<string>): void
    // {
    //     if (keys.isEmpty)
    //         return;

    //     this._client.unlink(...keys).catch(e => this._logger.logError(e));
    // }
}