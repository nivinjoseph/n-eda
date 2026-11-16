import { given } from "@nivinjoseph/n-defensive";
import { ApplicationException, Exception } from "@nivinjoseph/n-exception";
import { ComponentInstaller, inject, Registry } from "@nivinjoseph/n-ject";
import { ConsoleLogger, LogDateTimeZone, Logger } from "@nivinjoseph/n-log";
import { Deferred, Delay, DisposableWrapper, Duration, Serializable, serialize } from "@nivinjoseph/n-util";
import { Redis } from "ioredis";
import {
    EdaEvent, EdaEventHandler, EdaManager, RedisEventBus, RedisEventSubMgr, Topic, event
} from "../../src/index.js";


/**
 * Fixtures for the consumer's duplicate suppression.
 *
 * Every topic here has exactly one partition, so a test knows which Redis keys its events land under and can
 * seed or inspect them directly. The key helpers below restate the persisted key layout documented in
 * `ARCHITECTURE.md`; they are written out by hand rather than borrowed from the consumer, so a change to
 * that layout fails these tests instead of silently following it.
 */

/** The consumer group every dedupe fixture consumes as. Part of the tracked-keys Redis key. */
export const dedupeGroupId = "dedupe-test-group";

/** The hash-tagged prefix shared by every key of the topic's single partition. */
export function partitionPrefix(topic: string): string
{
    return `{n-eda-${topic}-0}`;
}

export function writeIndexKey(topic: string): string
{
    return `${partitionPrefix(topic)}-write-index`;
}

export function slotKey(topic: string, index: number): string
{
    return `${partitionPrefix(topic)}-${index}`;
}

export function readIndexKey(topic: string): string
{
    return `${partitionPrefix(topic)}-${dedupeGroupId}-read-index`;
}

export function trackedKeysKey(topic: string): string
{
    return `${partitionPrefix(topic)}-${dedupeGroupId}-tracked_keys`;
}


/**
 * Records every handler invocation, and lets a test hold a particular event's handler open so it can look at
 * the consumer while that event is still in flight.
 */
export class DedupeRecorder
{
    private readonly _started = new Array<string>();
    private readonly _handled = new Array<string>();
    private readonly _holds = new Map<string, Deferred<void>>();


    /** Makes the handler for `eventId` wait, once it has started, until {@link DedupeRecorder.release}. */
    public hold(eventId: string): void
    {
        given(eventId, "eventId").ensureHasValue().ensureIsString();

        this._holds.set(eventId, new Deferred<void>());
    }

    public release(eventId: string): void
    {
        given(eventId, "eventId").ensureHasValue().ensureIsString();

        this._holds.get(eventId)?.resolve();
    }

    public releaseAll(): void
    {
        this._holds.forEach(t => t.resolve());
    }

    public hasStarted(eventId: string): boolean
    {
        return this._started.includes(eventId);
    }

    /** How many times a handler ran to completion for `eventId`. */
    public countHandled(eventId: string): number
    {
        return this._handled.filter(t => t === eventId).length;
    }

    public async handle(eventId: string): Promise<void>
    {
        given(eventId, "eventId").ensureHasValue().ensureIsString();

        this._started.push(eventId);

        const hold = this._holds.get(eventId);
        if (hold != null)
            await hold.promise;

        this._handled.push(eventId);
    }
}


/**
 * Logs to the console like the other suites do, and also keeps every warning so a test can wait for the
 * consumer to reach a particular point instead of guessing how long that takes.
 */
export class RecordingLogger implements Logger
{
    private readonly _logger = new ConsoleLogger({ logDateTimeZone: LogDateTimeZone.est });
    private readonly _warnings = new Array<string>();
    private readonly _errorRejections = new Array<{ text: string; used: boolean; }>();


    /**
     * How many times a consume loop for `topic` has failed and backed off. Each failure is followed, five
     * seconds later, by another read of the same window — so a count of two means the window has been read
     * a second time, up to the point where it failed again.
     *
     * Note: this matches the wording of the warning the consume loop logs from its `catch` block in
     * `consumer.ts` — `Error in consumer => ...; Topic: <name>; ...`. It is the only signal the consumer
     * gives that a window failed. If that message is reworded, this returns 0 and the tests waiting on it
     * time out; fix the match here rather than looking for a consumer bug.
     */
    public countConsumerErrors(topic: string): number
    {
        given(topic, "topic").ensureHasValue().ensureIsString();

        return this._warnings
            .filter(t => t.includes("Error in consumer") && t.includes(`Topic: ${topic};`)).length;
    }

    public logDebug(debug: string): Promise<void>
    {
        return this._logger.logDebug(debug);
    }

    public logInfo(info: string): Promise<void>
    {
        return this._logger.logInfo(info);
    }

    public logWarning(warning: string | Exception): Promise<void>
    {
        this._warnings.push(typeof warning === "string" ? warning : warning.message);

        return this._logger.logWarning(warning);
    }

    /**
     * Makes the next `logError` whose message contains `text` reject, the way a logger that writes to a file
     * or over the network can. Matched on text so that it is used up by the error a test means it for, and
     * not by one from another topic's consumer.
     *
     * @returns an object whose `used` turns `true` once that `logError` has been rejected
     */
    public rejectNextError(text: string): { readonly used: boolean; }
    {
        given(text, "text").ensureHasValue().ensureIsString();

        const rejection = { text, used: false };
        this._errorRejections.push(rejection);

        return rejection;
    }

    public logError(error: string | Exception): Promise<void>
    {
        const message = typeof error === "string" ? error : error.message;

        const rejection = this._errorRejections.find(t => !t.used && message.includes(t.text));
        if (rejection != null)
        {
            rejection.used = true;
            return Promise.reject(new Error("injected logger failure"));
        }

        return this._logger.logError(error);
    }
}


@serialize("DedupeTest")
export class DedupeTestEvent extends Serializable implements EdaEvent
{
    private readonly _id: string;
    private readonly _key: string;


    @serialize
    public get id(): string { return this._id; }

    @serialize // has to be serialized for eda purposes
    public get name(): string { return (<Object>DedupeTestEvent).getTypeName(); }

    @serialize
    public get key(): string { return this._key; }

    public get partitionKey(): string { return this._key; }

    public get refId(): string { return this._key; }
    public get refType(): string { return "neda"; }


    public constructor(data: { id: string; key: string; })
    {
        super(data);

        const { id, key } = data;

        given(id, "id").ensureHasValue().ensureIsString();
        this._id = id;

        given(key, "key").ensureHasValue().ensureIsString();
        this._key = key;
    }
}

@event(DedupeTestEvent)
@inject("DedupeRecorder")
export class DedupeTestEventHandler implements EdaEventHandler<DedupeTestEvent>
{
    private readonly _recorder: DedupeRecorder;


    public constructor(recorder: DedupeRecorder)
    {
        given(recorder, "recorder").ensureHasValue().ensureIsObject();
        this._recorder = recorder;
    }


    public async handle(event: DedupeTestEvent): Promise<void>
    {
        given(event, "event").ensureHasValue().ensureIsObject().ensureIsType(DedupeTestEvent);

        await this._recorder.handle(event.id);
    }
}


/**
 * An event no handler is registered for. A consumer that reads one marks its id as tracked there and then,
 * without dispatching anything — which gives a test an id that is tracked at a known point in a window.
 */
@serialize("DedupeTest")
export class DedupeUnhandledEvent extends Serializable implements EdaEvent
{
    private readonly _id: string;


    @serialize
    public get id(): string { return this._id; }

    @serialize // has to be serialized for eda purposes
    public get name(): string { return (<Object>DedupeUnhandledEvent).getTypeName(); }

    public get partitionKey(): string { return "unhandled"; }

    public get refId(): string { return "unhandled"; }
    public get refType(): string { return "neda"; }


    public constructor(data: { id: string; })
    {
        super(data);

        const { id } = data;

        given(id, "id").ensureHasValue().ensureIsString();
        this._id = id;
    }
}


/**
 * An event that publishes normally but cannot be dispatched once it has been read back: its partition key
 * comes from a field that is not serialized, so the getter throws on the consuming side. The consumer reads
 * `partitionKey` before it hands the event to the broker, which makes that dispatch reject.
 */
@serialize("DedupeTest")
export class DedupeLostKeyEvent extends Serializable implements EdaEvent
{
    private readonly _id: string;
    private readonly _key: string | null;


    @serialize
    public get id(): string { return this._id; }

    @serialize // has to be serialized for eda purposes
    public get name(): string { return (<Object>DedupeLostKeyEvent).getTypeName(); }

    public get partitionKey(): string
    {
        if (this._key == null)
            throw new ApplicationException("the partition key was not carried in the serialized event");

        return this._key;
    }

    public get refId(): string { return this._id; }
    public get refType(): string { return "neda"; }


    public constructor(data: { id: string; key?: string; })
    {
        super(data);

        const { id, key } = data;

        given(id, "id").ensureHasValue().ensureIsString();
        this._id = id;

        given(key as string, "key").ensureIsString();
        this._key = key ?? null;
    }
}

/** Never runs: the event it is registered for is rejected before it reaches a processor. */
@event(DedupeLostKeyEvent)
@inject("DedupeRecorder")
export class DedupeLostKeyEventHandler implements EdaEventHandler<DedupeLostKeyEvent>
{
    private readonly _recorder: DedupeRecorder;


    public constructor(recorder: DedupeRecorder)
    {
        given(recorder, "recorder").ensureHasValue().ensureIsObject();
        this._recorder = recorder;
    }


    public async handle(event: DedupeLostKeyEvent): Promise<void>
    {
        given(event, "event").ensureHasValue().ensureIsObject().ensureIsType(DedupeLostKeyEvent);

        await this._recorder.handle(event.id);
    }
}


type RedisCommandCallback = (err: Error | null, result?: unknown) => void;

/**
 * Takes over the client's next call of `command` whose key is `key`. Every other call — a different key, or
 * any call after the one taken over — falls through to whatever was installed before, so several of these
 * can be stacked on one client and a consumer of another topic cannot use one up.
 *
 * @param behaviour - given `send`, which issues the real command without a callback, and the caller's
 * `callback`; returns what the command call should return
 */
function interceptNext(client: Redis, command: "lpush" | "unlink", key: string,
    behaviour: (send: () => Promise<unknown>, callback: RedisCommandCallback) => Promise<unknown>): void
{
    given(client, "client").ensureHasValue().ensureIsObject();
    given(key, "key").ensureHasValue().ensureIsString();

    // an own property shadows the command defined on the prototype, or an interceptor installed earlier
    const next = ((client as any)[command] as (...args: Array<unknown>) => Promise<unknown>).bind(client);
    let taken = false;

    (client as any)[command] = (...args: Array<unknown>): Promise<unknown> =>
    {
        if (taken || args[0] !== key)
            return next(...args);

        taken = true;

        const last = args[args.length - 1];
        const hasCallback = typeof last === "function";
        const callback: RedisCommandCallback = hasCallback
            ? last as RedisCommandCallback : (): void => { /* the caller passed none */ };
        const commandArgs = hasCallback ? args.slice(0, -1) : args;

        return behaviour(() => next(...commandArgs), callback);
    };
}

/**
 * Makes the client's next `lpush` to `key` fail the way a Redis error reply would. The consumer saves
 * tracked ids with `lpush`, so this leaves one save failed and its ids pending.
 *
 * The error's message names the key, so a test can pick this failure out of a log.
 *
 * @returns an object whose `used` turns `true` once the failure has been delivered
 */
export function failNextLpush(client: Redis, key: string): { readonly used: boolean; }
{
    const state = { used: false };

    interceptNext(client, "lpush", key, (_send, callback) =>
    {
        state.used = true;

        const error = new Error(`injected lpush failure for ${key}`);
        callback(error);

        return Promise.reject(error);
    });

    return state;
}

/**
 * Lets the client's next `unlink` of `key` reach Redis but holds its reply back until released, so the
 * caller keeps waiting on a delete that has in fact already happened. The consumer deletes its tracked-keys
 * list with `unlink` when it applies a clear, so this is a clear caught mid-flight.
 *
 * @returns an object whose `sent` turns `true` once the delete is on its way, and whose `release` lets the
 * reply through
 */
export function holdNextUnlinkReply(client: Redis, key: string): { readonly sent: boolean; release(): void; }
{
    const gate = new Deferred<void>();
    const state = { sent: false, release: (): void => gate.resolve() };

    interceptNext(client, "unlink", key, async (send, callback) =>
    {
        // issued now, so it reaches Redis ahead of any command the client is given while the reply is held
        const reply = send();
        state.sent = true;

        const result = await reply;
        await gate.promise;
        callback(null, result);

        return result;
    });

    return state;
}

/**
 * Holds the client's next `unlink` of `key` without sending it, and makes it fail once told to — a clear
 * whose delete is slow and then does not go through.
 *
 * @returns an object whose `started` turns `true` once the delete has been asked for, and whose `fail` makes
 * it fail
 */
export function holdThenFailNextUnlink(client: Redis, key: string): { readonly started: boolean; fail(): void; }
{
    const gate = new Deferred<void>();
    const state = { started: false, fail: (): void => gate.resolve() };

    interceptNext(client, "unlink", key, async (_send, callback) =>
    {
        state.started = true;

        await gate.promise;

        const error = new Error(`injected unlink failure for ${key}`);
        callback(error);

        throw error;
    });

    return state;
}


class DedupeComponentInstaller implements ComponentInstaller
{
    public async install(registry: Registry): Promise<void>
    {
        given(registry, "registry").ensureHasValue().ensureIsObject();

        const edaRedisClient = new Redis();
        const edaRedisClientDisposable = new DisposableWrapper(async () =>
        {
            await Delay.seconds(2);
            await new Promise<void>((resolve, _) =>
            {
                edaRedisClient.quit(() => resolve()).catch(e => console.error(e));
            });
        });

        registry
            .registerInstance("Logger", new RecordingLogger())
            .registerInstance("EdaRedisClient", edaRedisClient)
            .registerInstance("EdaRedisClientDisposable", edaRedisClientDisposable)
            .registerSingleton("DedupeRecorder", DedupeRecorder);
    }
}


/**
 * Bootstraps a manager that publishes to and consumes the given single-partition topics. Consumption is not
 * started, so a test can seed a topic first and control what the consumer's first read sees.
 *
 * The topics are force-published so that `DedupeUnhandledEvent`, which has no handler, is written at all.
 */
export async function createDedupeEdaManager(...topicNames: Array<string>): Promise<EdaManager>
{
    given(topicNames, "topicNames").ensureHasValue().ensureIsArray().ensureIsNotEmpty();

    const topics = topicNames.map(t => new Topic(t, Duration.fromHours(1), 1).subscribe().forcePublish());

    const edaManager = new EdaManager();
    edaManager
        .useInstaller(new DedupeComponentInstaller())
        .useConsumerName("dedupe-test")
        .registerTopics(...topics)
        .registerEventHandlers(DedupeTestEventHandler, DedupeLostKeyEventHandler)
        .registerEventBus(RedisEventBus)
        .registerEventSubscriptionManager(RedisEventSubMgr, dedupeGroupId);

    await edaManager.bootstrap();

    return edaManager;
}
