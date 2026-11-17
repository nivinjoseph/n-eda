import { given } from "@nivinjoseph/n-defensive";
import { ApplicationException, ObjectDisposedException } from "@nivinjoseph/n-exception";
import { EdaEvent } from "../eda-event.js";
import { EdaManager } from "../eda-manager.js";
import { EventBus, ObservableWatch } from "../event-bus.js";
import { getEventTopics } from "../event-topic.js";
// import * as Redis from "redis";
import { ConfigurationManager } from "@nivinjoseph/n-config";
import { inject } from "@nivinjoseph/n-ject";
import { Logger } from "@nivinjoseph/n-log";
import { Delay } from "@nivinjoseph/n-util";
import { Redis } from "ioredis";
import { EventRegistration } from "../event-registration.js";
import { NedaClearTrackedKeysEvent } from "./neda-clear-tracked-keys-event.js";
import { NedaDistributedObserverNotifyEvent } from "./neda-distributed-observer-notify-event.js";
import { Producer } from "./producer.js";

// public
/**
 * The Redis-backed `EventBus` — the only shipped implementation.
 *
 * Contract: register the **class** with `EdaManager.registerEventBus(RedisEventBus)`. It is
 * `@inject("EdaRedisClient")`, and resolves `"Logger"` from the container during `initialize`, so both DI
 * keys must be registered by your `ComponentInstaller`.
 *
 * Storage model: events are bucketed by partition, each partition's batch is deflate-compressed and stored
 * under a single `INCR`-allocated slot (`SETEX`), and a pub/sub doorbell wakes the matching consumer. See
 * `ARCHITECTURE.md` for the full key layout.
 *
 * Note: `dispose()` drains for a few seconds and flips a flag — it does **not** close the Redis client.
 * Register a `Disposable` alongside the client so the connection is actually torn down.
 */
@inject("EdaRedisClient")
export class RedisEventBus implements EventBus
{
    private readonly _nedaClearTrackedKeysEventName = (<Object>NedaClearTrackedKeysEvent).getTypeName();
    private readonly _client: Redis;
    private readonly _producers = new Map<string, Producer>();


    private _isDisposing = false;
    private _isDisposed = false;
    private _disposePromise: Promise<void> | null = null;
    private _manager: EdaManager = null as any;
    private _logger: Logger = null as any;


    /**
     * @param redisClient - injected from the DI key `"EdaRedisClient"`; shared with every producer and
     * consumer in the process
     */
    public constructor(redisClient: Redis)
    {
        given(redisClient, "redisClient").ensureHasValue().ensureIsObject();
        this._client = redisClient;
    }


    /**
     * Binds the bus to its manager and creates one `Producer` per partition of every enabled topic.
     *
     * Called by `EdaManager.bootstrap()` — never call it yourself.
     *
     * @param manager - the bootstrapping manager
     * @throws `ObjectDisposedException` if already disposed
     * @throws if the manager is missing or not an `EdaManager`, or if already initialized
     */
    public initialize(manager: EdaManager): void
    {
        given(manager, "manager").ensureHasValue().ensureIsObject().ensureIsType(EdaManager);
        given(this, "this").ensure(t => !t._manager, "already initialized");

        this._manager = manager;
        this._logger = this._manager.serviceLocator.resolve<Logger>("Logger");

        this._manager.topics.forEach(topic =>
        {
            if (topic.isDisabled)
                return;

            for (let partition = 0; partition < topic.numPartitions; partition++)
            {
                const key = this._generateKey(topic.name, partition);
                this._producers.set(key,
                    new Producer(key, this._client, this._logger, topic.name, topic.ttlMinutes, partition));
            }
        });
    }

    /**
     * Publishes events to the topics their classes declare with `@topic`, without naming a topic at the
     * call site. Everything documented on the form that takes a topic applies here too; see
     * `EventBus.publish` for the full contract.
     *
     * @param events - the events to publish; an empty list is a no-op
     * @throws if an event's class declares no topics, in addition to everything the other form throws
     */
    public async publish(...events: ReadonlyArray<EdaEvent>): Promise<void>;

    // Declared last to match `EventBus`, so type utilities keep seeing the original signature.
    /**
     * Publishes events to the topic passed as the first argument, plus every topic each event's class
     * declares with `@topic`. See `EventBus.publish` for the full contract.
     *
     * Note: every target topic is validated before anything is written, but the writes themselves are
     * independent — one topic can be written while another fails, in which case this rejects, once every
     * topic write has finished, and the observer fan-out does not run.
     *
     * @param topic - a registered topic name to publish to, in addition to the declared ones
     * @param events - the events to publish; an empty list is a no-op
     * @throws `ObjectDisposedException` if the bus has been disposed
     * @throws if the bus is not initialized, a passed or declared topic is not registered or is the
     * distributed observer topic, or an event lacks a string `id`/`name`
     */
    public async publish(topic: string, ...events: ReadonlyArray<EdaEvent>): Promise<void>;
    public async publish(...args: ReadonlyArray<string | EdaEvent>): Promise<void>
    {
        const topic = typeof args[0] === "string" ? args[0] : null;
        const events = (topic != null ? args.slice(1) : args) as ReadonlyArray<EdaEvent>;
        const destination = topic != null ? `topic ${topic}` : "declared topics";

        if (this._isDisposed)
        {
            await this._logger.logError(`Publishing events to ${destination} after event bus disposed.`);
            throw new ObjectDisposedException(this);
        }

        if (this._isDisposing)
            await this._logger.logWarning(`Publishing events to ${destination} while event bus disposing.`);

        given(this, "this")
            .ensure(t => !!t._manager, "not initialized");

        // a caller of the topic form whose topic turns out to be unset would otherwise be told its event is null
        if (args.length > 0 && typeof args[0] !== "string")
            given(args[0], "topic or first event").ensureHasValue()
                .ensure(t => typeof t === "object", "must be a topic name or an event");

        const observerTopicName = this._manager.distributedObserverTopic?.name ?? null;

        if (topic != null)
            given(topic, "topic").ensureHasValue().ensureIsString()
                .ensure(t => this._manager.topics.some(u => u.name === t),
                    "must be registered topic")
                .ensure(t => t !== observerTopicName,
                    "must not publish directly to distributed observer topic");

        given(events, "events").ensureHasValue().ensureIsArray();
        events.forEach(event =>
            given(event, "event").ensureHasValue().ensureIsObject()
                .ensureHasStructure({ id: "string", name: "string" }));

        // Every target of every event is resolved and validated here, before anything is written, so that
        // a bad address cannot leave some of an event's topics written and others not.
        const eventTargets = events.map(event =>
        {
            const declaredTopics = getEventTopics(event);

            given(event, "event")
                .ensure(_ => topic != null || declaredTopics.isNotEmpty,
                    `'${event.name}' has no topic; pass a topic to publish or decorate the event class with @topic`);

            declaredTopics.forEach(declaredTopic =>
            {
                const declaration = `'${declaredTopic}' declared on event '${event.name}'`;

                given(declaredTopic, "topic")
                    .ensure(t => this._manager.topics.some(u => u.name === t),
                        `${declaration} must be a registered topic`)
                    .ensure(t => t !== observerTopicName,
                        `${declaration} must not publish directly to distributed observer topic`);
            });

            const targetNames = new Set<string>(topic != null ? [topic, ...declaredTopics] : declaredTopics);

            return { event, targets: [...targetNames].map(t => this._manager.topics.find(u => u.name === t)!) };
        });

        const topicPartitionEvents = new Map<string, Map<number, Array<EdaEvent>>>();

        // The observer fan-out is decided per event and then applied to the whole call: it runs when at least
        // one event was written to a topic, or was addressed only to disabled topics. An event that an enabled
        // topic dropped does not count, which is what keeps a pure publisher from fanning out (known issue #2).
        let notifyObservers = false;

        for (const { event, targets } of eventTargets)
        {
            let hasEnabledTarget = false;
            let isWritten = false;

            for (const pubTopic of targets)
            {
                if (pubTopic.isDisabled)
                    continue;

                hasEnabledTarget = true; // This flow is for standard EDA

                const partitions = new Array<number>();

                if (event.name === this._nedaClearTrackedKeysEventName)
                {
                    for (let partition = 0; partition < pubTopic.numPartitions; partition++)
                        partitions.push(partition);
                }
                else
                {
                    // a declared topic gets no special treatment: same rule as a passed one
                    if (!this._manager.eventMap.has(event.name) && !pubTopic.isForce)
                        continue;

                    partitions.push(this._manager.mapToPartition(pubTopic.name, event));
                }

                isWritten = true;

                if (!topicPartitionEvents.has(pubTopic.name))
                    topicPartitionEvents.set(pubTopic.name, new Map<number, Array<EdaEvent>>());
                const partitionEvents = topicPartitionEvents.get(pubTopic.name)!;

                for (const partition of partitions)
                {
                    if (!partitionEvents.has(partition))
                        partitionEvents.set(partition, new Array<EdaEvent>());
                    partitionEvents.get(partition)!.push(event);
                }
            }

            if (isWritten || !hasEnabledTarget)
                notifyObservers = true;
        }

        if (topicPartitionEvents.size > 0)
        {
            const promises = new Array<Promise<void>>();
            topicPartitionEvents.forEach((partitionEvents, topicName) =>
            {
                partitionEvents.forEach((events, partition) =>
                {
                    const producerKey = this._generateKey(topicName, partition);
                    promises.push(this._producers.get(producerKey)!.produce(...events));
                });
            });

            // Every topic write is allowed to finish before a failure is reported, so that a rejection never
            // leaves a write from this call still running. A failed call skips the observer fan-out below.
            const results = await Promise.allSettled(promises);
            const failure = results.find((t): t is PromiseRejectedResult => t.status === "rejected");
            if (failure != null)
                throw failure.reason;
        }

        if (!notifyObservers)
            return;

        // once per call, not once per topic: an event written to several topics is still one event
        await this._publishToObservers(events);
    }

    // public publishToObservers(events: ReadonlyArray<EdaEvent>): Promise<void>
    // {
    //     // Distributed observer will be managed on a completely separate single topic with its own partitions and single consumer group
    // }

    // public subscribeToObservables(subscriber: string, watches: ReadonlyArray<string>): Promise<void>
    // {
    //     // I the subscriber want to be notified about the things that I am watching

    //     // subscriber key has a corresponding set of watch keys. 
    //     // This information is used to create a delta to figure out unsubscribes automatically

    //     // for each watch key, there is a set of subscribers
    // }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    public async subscribeToObservables(observerType: Function, observerId: string, watches: ReadonlyArray<ObservableWatch>): Promise<void>
    {
        given(observerType, "observerType").ensureHasValue().ensureIsFunction();
        given(observerId, "observerId").ensureHasValue().ensureIsString();
        given(watches, "watches").ensureHasValue().ensureIsArray();

        if (watches.isEmpty)
            return;

        const observerTypeName = (<Object>observerType).getTypeName();
        const observerKey = this._generateObserverKey(observerTypeName, observerId);

        const promises = new Array<Promise<void>>();

        for (const watch of watches)
        {
            const observableType = (<Object>watch.observableType).getTypeName();
            const observableEventType = (<Object>watch.observableEventType).getTypeName();

            const observableKey = this._generateObservableKey(watch);

            // if we want to subscribe, then the handler has to be a registered up front
            const observationKey = EventRegistration.generateObservationKey(observerTypeName,
                observableType, observableEventType);
            if (!this._manager.observerEventMap.has(observationKey))
                throw new ApplicationException(`No handler registered for observation key '${observationKey}'`);

            promises.push(new Promise<void>((resolve, reject) =>
            {
                this._client.sadd(observableKey, observerKey, (err) =>
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

        await Promise.all(promises);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    public async unsubscribeFromObservables(observerType: Function, observerId: string, watches: ReadonlyArray<ObservableWatch>): Promise<void>
    {
        given(observerType, "observerType").ensureHasValue().ensureIsFunction();
        given(observerId, "observerId").ensureHasValue().ensureIsString();
        given(watches, "watches").ensureHasValue().ensureIsArray();

        if (watches.isEmpty)
            return;

        const observerTypeName = (<Object>observerType).getTypeName();
        const observerKey = this._generateObserverKey(observerTypeName, observerId);

        const promises = new Array<Promise<void>>();

        for (const watch of watches)
        {
            const observableKey = this._generateObservableKey(watch);

            promises.push(new Promise<void>((resolve, reject) =>
            {
                this._client.srem(observableKey, observerKey, (err) =>
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

        await Promise.all(promises);
    }

    public async dispose(): Promise<void>
    {
        if (!this._isDisposing)
        {
            this._isDisposing = true;
            // this._disposePromise = new Promise((resolve, _) => this._client.quit(() => resolve()));
            this._disposePromise = Delay.seconds(ConfigurationManager.getConfig<string>("env") === "dev" ? 2 : 10)
                .then(() =>
                {
                    this._isDisposed = true;
                });
        }

        await this._disposePromise;
    }

    private async _publishToObservers(events: ReadonlyArray<EdaEvent>): Promise<void>
    {
        if (this._manager.distributedObserverTopic != null && !this._manager.distributedObserverTopic.isDisabled)
        {
            const partitionEvents = new Map<number, Array<EdaEvent>>();

            for (const event of events)
            {
                // we know the event type and the observable id (ref id)

                // what we want to do do is figure if any observer has subscribed to this refId and this eventType
                // Note: in a multi-tenant system, the refId would include the orgId

                const observableType = event.refType;
                const observableId = event.refId;
                const observableEventType = event.name;

                const observableKey = this._generateObservableKey({ observableType, observableId, observableEventType });

                const hasSubs = await this._checkForSubscribers(observableKey);
                if (hasSubs)
                {
                    const subs = await this._fetchSubscribers(observableKey);

                    if (subs.isNotEmpty)
                    {
                        for (const sub of subs)
                        {
                            const [observerTypeName, observerId] = sub.split(".");

                            // TODO: do be really care about this check? this check is actually done on subscribe and wouldn't make sense here from a distributed systems standpoint considering rolling deployments
                            // const observationKey = EventRegistration.generateObservationKey(
                            //     observerTypeName, observableType,
                            //     observableEventType);
                            // if (!this._manager.observerEventMap.has(observationKey))
                            //     continue;


                            // So for each sub
                            // we are going to wrap this event into a DistributedObserverEvent
                            // and send it with the partition key being the observerId
                            // and we will send it on the distributed observer topic

                            const distributedObserverEvent = new NedaDistributedObserverNotifyEvent({
                                observerTypeName,
                                observerId,
                                observedEventId: event.id,
                                observedEvent: event
                            });

                            const partition = this._manager.mapToPartition(
                                this._manager.distributedObserverTopic.name, distributedObserverEvent);
                            if (!partitionEvents.has(partition))
                                partitionEvents.set(partition, new Array<EdaEvent>());
                            partitionEvents.get(partition)!.push(distributedObserverEvent);
                        }
                    }
                }
            }

            if (partitionEvents.size === 0)
                return;

            const promises = new Array<Promise<void>>();
            partitionEvents.forEach((events, partition) =>
            {
                const producerKey = this._generateKey(this._manager.distributedObserverTopic!.name, partition);
                promises.push(this._producers.get(producerKey)!.produce(...events));
            });
            await Promise.all(promises);
        }
    }

    private _generateKey(topic: string, partition: number): string
    {
        return `${topic}+++${partition}`;
    }

    private _generateObservableKey(watch: ObservableWatch): string
    {
        given(watch, "watch").ensureHasValue().ensureIsObject();

        const observableTypeName = typeof watch.observableType === "string"
            ? watch.observableType : (<Object>watch.observableType).getTypeName();
        const observableId = watch.observableId;
        const observableEventTypeName = typeof watch.observableEventType === "string"
            ? watch.observableEventType : (<Object>watch.observableEventType).getTypeName();

        return `n-eda-observable-${observableTypeName}.${observableId}.${observableEventTypeName}`;
    }

    private _generateObserverKey(observerTypeName: string, observerId: string): string
    {
        given(observerTypeName, "observerTypeName").ensureHasValue().ensureIsString();
        given(observerId, "observerId").ensureHasValue().ensureIsString();

        return `${observerTypeName}.${observerId}`;
    }

    private _checkForSubscribers(key: string): Promise<boolean>
    {
        return new Promise((resolve, reject) =>
        {
            this._client.scard(key, (err, val) =>
            {
                if (err)
                {
                    reject(err);
                    return;
                }

                resolve(val! > 0);
            }).catch(e => reject(e));
        });
    }

    private _fetchSubscribers(key: string): Promise<Array<string>>
    {
        return new Promise((resolve, reject) =>
        {
            this._client.smembers(key, (err, val) =>
            {
                if (err)
                {
                    reject(err);
                    return;
                }

                resolve(val ?? []);
            }).catch(e => reject(e));
        });
    }
}