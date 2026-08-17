import { given } from "@nivinjoseph/n-defensive";
import { Make } from "@nivinjoseph/n-util";
// import * as Redis from "redis";
import { Exception } from "@nivinjoseph/n-exception";
import { Logger } from "@nivinjoseph/n-log";
import { Redis } from "ioredis";
import Zlib from "zlib";
import { EdaEvent } from "../eda-event.js";
// import * as MessagePack from "msgpackr";
// import * as Snappy from "snappy";
import * as otelApi from "@opentelemetry/api";
import {
    ATTR_MESSAGING_SYSTEM,
    ATTR_MESSAGING_OPERATION_NAME,
    ATTR_MESSAGING_OPERATION_TYPE,
    ATTR_MESSAGING_DESTINATION_NAME,
    ATTR_MESSAGING_DESTINATION_TEMPORARY,
    ATTR_MESSAGING_MESSAGE_ID,
    ATTR_MESSAGING_MESSAGE_CONVERSATION_ID
} from "@opentelemetry/semantic-conventions/incubating";
import { ATTR_DB_OPERATION_NAME, ATTR_ERROR_TYPE } from "@opentelemetry/semantic-conventions";
import {
    ATTR_NEDA_COMPONENT,
    ATTR_NEDA_DIRECTION,
    ATTR_NEDA_EVENT_NAME,
    errorTypeOf,
    instruments,
    MESSAGING_SYSTEM,
    timeRedisCommand
} from "../metrics.js";


export class Producer
{
    private readonly _edaPrefix = "n-eda";
    private readonly _key: string;
    private readonly _client: Redis;
    private readonly _logger: Logger;
    private readonly _topic: string;
    private readonly _ttlSeconds: number;
    private readonly _partition: number;
    
    
    public get id(): string { return `{${this._edaPrefix}-${this._topic}-${this._partition}}`; }
    
    public get writeIndexKey(): string { return `${this.id}-write-index`; }


    public constructor(key: string, client: Redis, logger: Logger, topic: string, ttlMinutes: number, partition: number)
    {
        given(key, "key").ensureHasValue().ensureIsString();
        this._key = key;
        
        given(client, "client").ensureHasValue().ensureIsObject();
        this._client = client;

        given(logger, "logger").ensureHasValue().ensureIsObject();
        this._logger = logger;

        given(topic, "topic").ensureHasValue().ensureIsString();
        this._topic = topic;

        given(ttlMinutes, "ttlMinutes").ensureHasValue().ensureIsNumber();
        this._ttlSeconds = ttlMinutes * 60;

        given(partition, "partition").ensureHasValue().ensureIsNumber();
        this._partition = partition;
    }


    public async produce(...events: ReadonlyArray<EdaEvent>): Promise<void>
    {
        given(events, "events").ensureHasValue().ensureIsArray();
        if (events.isEmpty)
            return;
        
        const serialized = new Array<object>();
        const spans = new Array<otelApi.Span>();
        // Tallied here rather than emitted per event so a large batch costs one counter
        // add per distinct event name instead of one per event.
        const eventNameCounts = new Map<string, number>();

        const tracer = otelApi.trace.getTracer("n-eda");
        events.forEach((event) =>
        {
            eventNameCounts.set(event.name, (eventNameCounts.get(event.name) ?? 0) + 1);

            const activeSpan = otelApi.trace.getActiveSpan();
            
            const span = tracer.startSpan(`event.${event.name} publish`, {
                kind: otelApi.SpanKind.PRODUCER,
                attributes: {
                    [ATTR_MESSAGING_SYSTEM]: "n-eda",
                    [ATTR_MESSAGING_OPERATION_TYPE]: "send",
                    [ATTR_MESSAGING_DESTINATION_NAME]: this._key,
                    [ATTR_MESSAGING_DESTINATION_TEMPORARY]: false,
                    [ATTR_MESSAGING_MESSAGE_ID]: event.id,
                    [ATTR_MESSAGING_MESSAGE_CONVERSATION_ID]: event.partitionKey
                }
            });

            const traceData = {};
            otelApi.propagation.inject(otelApi.trace.setSpan(otelApi.context.active(), span), traceData);
            
            const serializedEvent = event.serialize();
            (<any>serializedEvent)["$traceData"] = traceData;

            serialized.push(serializedEvent);
            spans.push(span);
            
            if (activeSpan)
                otelApi.trace.setSpan(otelApi.context.active(), activeSpan);
        });
        
        const startedAt = performance.now();
        const compressed = await this._compressEvents(serialized);
        let errorType: string | null = null;

        // The whole batch becomes ONE Redis key with ONE write-index increment, which is why
        // the partition indexes count batches rather than events. This histogram is the
        // multiplier between batch lag and actual event backlog.
        instruments().batchMessageCount.record(events.length, {
            [ATTR_MESSAGING_SYSTEM]: MESSAGING_SYSTEM,
            [ATTR_MESSAGING_DESTINATION_NAME]: this._topic
        });
        instruments().payloadSize.record(compressed.length, {
            [ATTR_MESSAGING_SYSTEM]: MESSAGING_SYSTEM,
            [ATTR_MESSAGING_DESTINATION_NAME]: this._topic,
            [ATTR_NEDA_DIRECTION]: "publish"
        });

        try
        {
            const writeIndex = await Make.retryWithExponentialBackoff(() => this._incrementPartitionWriteIndex(), 5)();
            await Make.retryWithExponentialBackoff(() => this._storeEvents(writeIndex, compressed), 5)();
        }
        catch (error: any)
        {
            errorType = errorTypeOf(error);
            const message = `Error while storing ${events.length} events => Topic: ${this._topic}; Partition: ${this._partition};`;
            await this._logger.logWarning(message);
            await this._logger.logError(error);
            spans.forEach(span =>
            {
                span.recordException(error as Exception);
                span.setStatus({
                    code: otelApi.SpanStatusCode.ERROR,
                    message
                });
            });
            throw error;
        }
        finally
        {
            // Bare topic name, never `this._key` -- that is `topic+++partition`, which is
            // right for a span's destination but would make topic-level aggregation
            // impossible and multiply series by the partition count.
            const attributes: otelApi.Attributes = {
                [ATTR_MESSAGING_SYSTEM]: MESSAGING_SYSTEM,
                [ATTR_MESSAGING_OPERATION_NAME]: "publish",
                [ATTR_MESSAGING_DESTINATION_NAME]: this._topic
            };

            if (errorType !== null)
                attributes[ATTR_ERROR_TYPE] = errorType;

            instruments().clientOperationDuration.record((performance.now() - startedAt) / 1000, attributes);

            // Event name goes on the counter but never on the histogram -- a counter is one
            // datapoint per series, whereas a histogram would multiply it by the bucket count.
            for (const [eventName, count] of eventNameCounts)
                instruments().sentMessages.add(count, { ...attributes, [ATTR_NEDA_EVENT_NAME]: eventName });

            spans.forEach(span => span.end());
        }
    }

    private async _compressEvents(events: ReadonlyArray<object>): Promise<Buffer>
    {
        const startedAt = performance.now();
        try
        {
            return await Make.callbackToPromise<Buffer>(Zlib.deflateRaw)(Buffer.from(JSON.stringify(events), "utf8"));
        }
        finally
        {
            instruments().compressionDuration.record((performance.now() - startedAt) / 1000, {
                [ATTR_MESSAGING_SYSTEM]: MESSAGING_SYSTEM,
                [ATTR_NEDA_DIRECTION]: "publish"
            });
        }
    }

    private _incrementPartitionWriteIndex(): Promise<number>
    {
        // Wrapping the inner call rather than the retry wrapper around it is deliberate:
        // Make.retryWithExponentialBackoff invokes this once per attempt, so each failed
        // attempt records its own datapoint carrying error.type. That makes retry counts
        // derivable without reimplementing the backoff.
        return timeRedisCommand("INCR", "producer", () => new Promise<number>((resolve, reject) =>
        {
            this._client.incr(this.writeIndexKey, (err, val) =>
            {
                if (err)
                {
                    reject(err);
                    return;
                }

                resolve(val!);
            }).catch(e => reject(e));
        }));
    }
    
    // private _storeEvents(writeIndex: number, eventData: Buffer): Promise<void>
    // {
    //     return new Promise((resolve, reject) =>
    //     {
    //         const key = `{${this._edaPrefix}-${this._topic}-${this._partition}}-${writeIndex}`;

    //         this._client.setex(key, this._ttlSeconds, eventData, (err) =>
    //         {
    //             if (err)
    //             {
    //                 reject(err);
    //                 return;
    //             }

    //             resolve();
    //         }).catch(e => reject(e));
    //     });
    // }
    
    private async _storeEvents(writeIndex: number, eventData: Buffer): Promise<void>
    {
        const key = `${this.id}-${writeIndex}`;

        const results = await timeRedisCommand("SETEX|PUBLISH", "producer", () => this._client
            .pipeline()
            .setex(key, this._ttlSeconds, eventData)
            .publish(`${this.id}-changed`, this.id)
            .exec());

        // A pipeline resolves with [Error | null, value] tuples and does NOT reject when an
        // individual command fails. Discarding this result meant a failed SETEX was silently
        // swallowed: the retry wrapper never fired, the write index had already advanced, and
        // the consumer would spin through its 200-attempt read race before dropping the
        // event permanently. Surface it so the retry wrapper can do its job.
        const failures = (results ?? []).filter(t => t[0] != null);
        if (failures.length > 0)
        {
            instruments().redisPipelineErrors.add(failures.length, {
                [ATTR_DB_OPERATION_NAME]: "SETEX|PUBLISH",
                [ATTR_NEDA_COMPONENT]: "producer"
            });

            const failure: Error = failures[0][0]!;
            throw failure;
        }
    }
    
    // private async _publish(writeIndex: number, eventData: Buffer): Promise<void>
    // {
    //     const key = `{${this._edaPrefix}-${this._topic}-${this._partition}}-${writeIndex}`;

    //     await this._client
    //         .pipeline()
    //         .setex(key, this._ttlSeconds, eventData)
    //         .incr(this.writeIndexKey)
    //         .publish(`${this.writeIndexKey}-changed`, this.writeIndexKey)
    //         .exec();
    // }

    // private _storeEvents(writeIndexUpper: number, events: Array<any>): Promise<void>
    // {
    //     return new Promise((resolve, reject) =>
    //     {
    //         const expirySeconds = this._ttlMinutes * 60;

    //         let multi = this._client.multi();
    //         events.forEach((t, index) =>
    //         {
    //             const writeIndex = writeIndexUpper - events.length + 1 + index;
    //             const key = `${this._edaPrefix}-${this._topic}-${this._partition}-${writeIndex}`;
    //             multi = multi.setex(key, expirySeconds, t);
    //         });

    //         multi.exec((err) =>
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
}

// export class Producer
// {
//     private readonly _edaPrefix = "n-eda";
//     private readonly _client: Redis.RedisClient;
//     private readonly _logger: Logger;
//     private readonly _topic: string;
//     private readonly _ttlMinutes: number;
//     private readonly _partition: number;


//     public constructor(client: Redis.RedisClient, logger: Logger, topic: string, ttlMinutes: number,
//         partition: number)
//     {
//         given(client, "client").ensureHasValue().ensureIsObject();
//         this._client = client;

//         given(logger, "logger").ensureHasValue().ensureIsObject();
//         this._logger = logger;

//         given(topic, "topic").ensureHasValue().ensureIsString();
//         this._topic = topic;

//         given(ttlMinutes, "ttlMinutes").ensureHasValue().ensureIsNumber();
//         this._ttlMinutes = ttlMinutes;

//         given(partition, "partition").ensureHasValue().ensureIsNumber();
//         this._partition = partition;
//     }


//     public async produce(...events: ReadonlyArray<EdaEvent>): Promise<void>
//     {
//         given(events, "events").ensureHasValue().ensureIsArray();
//         if (events.isEmpty)
//             return;

//         const indexed = await events.mapAsync(async (t) => ({
//             event: t,
//             compressed: await this._compressEvent(t.serialize())
//         }));
        
        
//         try 
//         {
//             const writeIndexUpper = await Make.retryWithExponentialBackoff(() => this._incrementPartitionWriteIndex(indexed.length), 5)();
//             await Make.retryWithExponentialBackoff(() => this._storeEvents(writeIndexUpper, indexed.map(t => t.compressed)), 5)();
//         }
//         catch (error)
//         {
//             await this._logger.logWarning(`Error while storing ${indexed.length} events => Topic: ${this._topic}; Partition: ${this._partition};`);
//             await this._logger.logError(error as Exception);
//             throw error;
//         }
//     }

//     private _compressEvent(event: object): Promise<Buffer>
//     {
//         return Make.callbackToPromise<Buffer>(Zlib.deflateRaw)(Buffer.from(JSON.stringify(event), "utf8"));
//     }

//     private _incrementPartitionWriteIndex(by: number): Promise<number>
//     {
//         return new Promise((resolve, reject) =>
//         {
//             const key = `${this._edaPrefix}-${this._topic}-${this._partition}-write-index`;

//             this._client.incrby(key, by, (err, val) =>
//             {
//                 if (err)
//                 {
//                     reject(err);
//                     return;
//                 }

//                 resolve(val);
//             });
//         });
//     }

//     private _storeEvents(writeIndexUpper: number, events: Array<any>): Promise<void>
//     {
//         return new Promise((resolve, reject) =>
//         {
//             const expirySeconds = this._ttlMinutes * 60;

//             let multi = this._client.multi();
//             events.forEach((t, index) =>
//             {
//                 const writeIndex = writeIndexUpper - events.length + 1 + index;
//                 const key = `${this._edaPrefix}-${this._topic}-${this._partition}-${writeIndex}`;
//                 multi = multi.setex(key, expirySeconds, t);
//             });

//             multi.exec((err) =>
//             {
//                 if (err)
//                 {
//                     reject(err);
//                     return;
//                 }

//                 resolve();
//             });
//         });
//     }
// }


// export class Producer
// {
//     private readonly _edaPrefix = "n-eda";
//     private readonly _client: Redis.RedisClient;
//     private readonly _logger: Logger;
//     private readonly _topic: string;
//     private readonly _ttlMinutes: number;
//     private readonly _partition: number;


//     public constructor(client: Redis.RedisClient, logger: Logger, topic: string, ttlMinutes: number,
//         partition: number)
//     {
//         given(client, "client").ensureHasValue().ensureIsObject();
//         this._client = client;

//         given(logger, "logger").ensureHasValue().ensureIsObject();
//         this._logger = logger;

//         given(topic, "topic").ensureHasValue().ensureIsString();
//         this._topic = topic;

//         given(ttlMinutes, "ttlMinutes").ensureHasValue().ensureIsNumber();
//         this._ttlMinutes = ttlMinutes;

//         given(partition, "partition").ensureHasValue().ensureIsNumber();
//         this._partition = partition;
//     }

    
//     public async produce(...events: ReadonlyArray<EdaEvent>): Promise<void>
//     {
//         given(events, "events").ensureHasValue().ensureIsArray();
//         if (events.isEmpty)
//             return;

//         const indexed = await events.mapAsync(async (t) => ({
//             event: t,
//             compressed: await this._compressEvent(t.serialize())
//         }));

//         for (const item of indexed)
//         {
//             try 
//             {
//                 const writeIndex = await Make.retryWithExponentialBackoff(() => this._incrementPartitionWriteIndex(), 5)();
//                 await Make.retryWithExponentialBackoff(() => this._storeEvent(writeIndex, item.compressed), 5)();
//             }
//             catch (error)
//             {
//                 await this._logger.logWarning(`Error while storing event of type ${item.event.name}  => Topic: ${this._topic}; Partition: ${this._partition};`);
//                 await this._logger.logError(error as Exception);
//                 throw error;
//             }
//         }
//     }

//     // private async _compressEvent(event: object): Promise<Buffer>
//     // {
//     //     given(event, "event").ensureHasValue().ensureIsObject();

//     //     const compressed = await Make.callbackToPromise<Buffer>(Zlib.brotliCompress)(Buffer.from(JSON.stringify(event), "utf8"),
//     //         { params: { [Zlib.constants.BROTLI_PARAM_MODE]: Zlib.constants.BROTLI_MODE_TEXT } });

//     //     return compressed;
//     // }
    
//     // private async _compressEvent(event: object): Promise<Buffer>
//     // {
//     //     const compressed = await Snappy.compress(MessagePack.pack(event));

//     //     return compressed;
//     // }
    
//     private _compressEvent(event: object): Promise<Buffer>
//     {
//         return Make.callbackToPromise<Buffer>(Zlib.deflateRaw)(Buffer.from(JSON.stringify(event), "utf8"));
//     }
    
//     private _incrementPartitionWriteIndex(): Promise<number>
//     {
//         return new Promise((resolve, reject) =>
//         {
//             const key = `${this._edaPrefix}-${this._topic}-${this._partition}-write-index`;

//             this._client.incr(key, (err, val) =>
//             {
//                 if (err)
//                 {
//                     reject(err);
//                     return;
//                 }

//                 resolve(val);
//             });
//         });
//     }

//     private _storeEvent(writeIndex: number, eventData: string | Buffer): Promise<void>
//     {
//         return new Promise((resolve, reject) =>
//         {
//             given(writeIndex, "writeIndex").ensureHasValue().ensureIsNumber();
//             given(eventData, "eventData").ensureHasValue();

//             const key = `${this._edaPrefix}-${this._topic}-${this._partition}-${writeIndex}`;
//             // const expirySeconds = 60 * 60 * 4;
//             const expirySeconds = this._ttlMinutes * 60;

//             this._client.setex(key, expirySeconds, eventData as any, (err) =>
//             {
//                 if (err)
//                 {
//                     reject(err);
//                     return;
//                 }

//                 resolve();
//             });
//         });
//     }
// }





// export class Producer
// {
//     private readonly _edaPrefix = "n-eda";
//     private readonly _client: Redis.RedisClient;
//     private readonly _logger: Logger;
//     private readonly _topic: string;
//     private readonly _ttlMinutes: number;
//     private readonly _partition: number;
//     private readonly _mutex = new Mutex();
    
    
//     public constructor(client: Redis.RedisClient, logger: Logger, topic: string, ttlMinutes: number,
//         partition: number)
//     {
//         given(client, "client").ensureHasValue().ensureIsObject();
//         this._client = client;
        
//         given(logger, "logger").ensureHasValue().ensureIsObject();
//         this._logger = logger;

//         given(topic, "topic").ensureHasValue().ensureIsString();
//         this._topic = topic;
        
//         given(ttlMinutes, "ttlMinutes").ensureHasValue().ensureIsNumber();
//         this._ttlMinutes = ttlMinutes;

//         given(partition, "partition").ensureHasValue().ensureIsNumber();
//         this._partition = partition;
//     }
    
//     public async produce(...events: ReadonlyArray<EdaEvent>): Promise<void>
//     {
//         given(events, "events").ensureHasValue().ensureIsArray();
//         if (events.isEmpty)
//             return;

//         const indexed = await events.mapAsync(async (t) => ({
//             index: 0,
//             event: t,
//             compressed: await this.compressEvent((t).serialize())
//         }));
        
//         const upperBoundWriteIndex = await this.acquireWriteIndex(events.length);
//         const lowerBoundWriteIndex = upperBoundWriteIndex - events.length;
        
//         for (let i = 0; i < events.length; i++)
//             indexed[i].index = lowerBoundWriteIndex + i + 1;
        
//         await indexed.forEachAsync(async (t) =>
//         {
//             const maxStoreAttempts = 500; // correlates with read attempts in consumer
//             let numStoreAttempts = 0;
//             let stored = false;
            
//             while (stored === false && numStoreAttempts < maxStoreAttempts)
//             {
//                 numStoreAttempts++;
                
//                 try 
//                 {
//                     await this.storeEvent(t.index, t.compressed);
//                     stored = true;
//                 }
//                 catch (error)
//                 {
//                     await this._logger.logWarning(`Error while storing event of type ${t.event.name} (ATTEMPT = ${numStoreAttempts}) => Topic: ${this._topic}; Partition: ${this._partition}; WriteIndex: ${t.index};`);
//                     await this._logger.logError(error);
                    
//                     if (numStoreAttempts >= maxStoreAttempts)
//                         throw error;
//                     else
//                         await Delay.milliseconds(20);
//                 }
//             }
            
//             // await Make.retryWithDelay(async () =>
//             // {
//             //     try 
//             //     {
//             //         await this.storeEvent(t.index, t.compressed);
//             //     }
//             //     catch (error)
//             //     {
//             //         await this._logger.logWarning(`Error while storing event of type ${t.event.name} => Topic: ${this._topic}; Partition: ${this._partition}; WriteIndex: ${t.index};`);
//             //         await this._logger.logError(error);
//             //         throw error;
//             //     }
//             // }, 20, 500)();
//         });
//     }
    
//     private async compressEvent(event: object): Promise<Buffer>
//     {
//         given(event, "event").ensureHasValue().ensureIsObject();

//         const compressed = await Make.callbackToPromise<Buffer>(Zlib.brotliCompress)(Buffer.from(JSON.stringify(event), "utf8"),
//             { params: { [Zlib.constants.BROTLI_PARAM_MODE]: Zlib.constants.BROTLI_MODE_TEXT } });

//         return compressed;
//     }
//     // @ts-ignore
//     private async acquireWriteIndex(incrBy: number): Promise<number>
//     {
//         await this._mutex.lock();

//         try
//         {
//             const maxAttempts = 20;
//             let numAttempts = 0;
            
//             while (numAttempts < maxAttempts)
//             {
//                 numAttempts++;
                
//                 try 
//                 {
//                     return await this.incrementPartitionWriteIndex(incrBy);
//                 }
//                 catch (error)
//                 {
//                     await this._logger.logWarning(`Error while incrementing partition write index (ATTEMPT = ${numAttempts}) => Topic: ${this._topic}; Partition: ${this._partition};`);
//                     await this._logger.logError(error);
                    
//                     if (numAttempts >= maxAttempts)
//                         throw error;
//                     else
//                         await Delay.milliseconds(500);
//                 }
//             }
//         }
//         finally
//         {
//             this._mutex.release();
//         }
//     }

//     private incrementPartitionWriteIndex(incrBy: number): Promise<number>
//     {
//         return new Promise((resolve, reject) =>
//         {
//             given(incrBy, "incrBy").ensureHasValue().ensureIsNumber().ensure(t => t > 0, "has to be > 0");
            
//             const key = `${this._edaPrefix}-${this._topic}-${this._partition}-write-index`;

//             this._client.incrby(key, incrBy, (err, val) =>
//             {
//                 if (err)
//                 {
//                     reject(err);
//                     return;
//                 }

//                 resolve(val);
//             });
//         });
//     }

//     private storeEvent(writeIndex: number, eventData: string | Buffer): Promise<void>
//     {
//         return new Promise((resolve, reject) =>
//         {
//             given(writeIndex, "writeIndex").ensureHasValue().ensureIsNumber();
//             given(eventData, "eventData").ensureHasValue();

//             const key = `${this._edaPrefix}-${this._topic}-${this._partition}-${writeIndex}`;
//             // const expirySeconds = 60 * 60 * 4;
//             const expirySeconds = this._ttlMinutes * 60;

//             this._client.setex(key.trim(), expirySeconds, eventData as any, (err) =>
//             {
//                 if (err)
//                 {
//                     reject(err);
//                     return;
//                 }

//                 resolve();
//             });
//         });
//     }
// }