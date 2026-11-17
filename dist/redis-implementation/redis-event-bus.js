import { __esDecorate, __runInitializers } from "tslib";
import { given } from "@nivinjoseph/n-defensive";
import { ApplicationException, ObjectDisposedException } from "@nivinjoseph/n-exception";
import { EdaManager } from "../eda-manager.js";
import { getEventTopics } from "../event-topic.js";
// import * as Redis from "redis";
import { ConfigurationManager } from "@nivinjoseph/n-config";
import { inject } from "@nivinjoseph/n-ject";
import { Delay } from "@nivinjoseph/n-util";
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
let RedisEventBus = (() => {
    let _classDecorators = [inject("EdaRedisClient")];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var RedisEventBus = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            RedisEventBus = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        _nedaClearTrackedKeysEventName = NedaClearTrackedKeysEvent.getTypeName();
        _client;
        _producers = new Map();
        _isDisposing = false;
        _isDisposed = false;
        _disposePromise = null;
        _manager = null;
        _logger = null;
        /**
         * @param redisClient - injected from the DI key `"EdaRedisClient"`; shared with every producer and
         * consumer in the process
         */
        constructor(redisClient) {
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
        initialize(manager) {
            given(manager, "manager").ensureHasValue().ensureIsObject().ensureIsType(EdaManager);
            given(this, "this").ensure(t => !t._manager, "already initialized");
            this._manager = manager;
            this._logger = this._manager.serviceLocator.resolve("Logger");
            this._manager.topics.forEach(topic => {
                if (topic.isDisabled)
                    return;
                for (let partition = 0; partition < topic.numPartitions; partition++) {
                    const key = this._generateKey(topic.name, partition);
                    this._producers.set(key, new Producer(key, this._client, this._logger, topic.name, topic.ttlMinutes, partition));
                }
            });
        }
        async publish(...args) {
            const topic = typeof args[0] === "string" ? args[0] : null;
            const events = (topic != null ? args.slice(1) : args);
            const destination = topic != null ? `topic ${topic}` : "declared topics";
            if (this._isDisposed) {
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
                    .ensure(t => this._manager.topics.some(u => u.name === t), "must be registered topic")
                    .ensure(t => t !== observerTopicName, "must not publish directly to distributed observer topic");
            given(events, "events").ensureHasValue().ensureIsArray();
            events.forEach(event => given(event, "event").ensureHasValue().ensureIsObject()
                .ensureHasStructure({ id: "string", name: "string" }));
            // Every target of every event is resolved and validated here, before anything is written, so that
            // a bad address cannot leave some of an event's topics written and others not.
            const eventTargets = events.map(event => {
                const declaredTopics = getEventTopics(event);
                given(event, "event")
                    .ensure(_ => topic != null || declaredTopics.isNotEmpty, `'${event.name}' has no topic; pass a topic to publish or decorate the event class with @topic`);
                declaredTopics.forEach(declaredTopic => {
                    const declaration = `'${declaredTopic}' declared on event '${event.name}'`;
                    given(declaredTopic, "topic")
                        .ensure(t => this._manager.topics.some(u => u.name === t), `${declaration} must be a registered topic`)
                        .ensure(t => t !== observerTopicName, `${declaration} must not publish directly to distributed observer topic`);
                });
                const targetNames = new Set(topic != null ? [topic, ...declaredTopics] : declaredTopics);
                return { event, targets: [...targetNames].map(t => this._manager.topics.find(u => u.name === t)) };
            });
            const topicPartitionEvents = new Map();
            // The observer fan-out is decided per event and then applied to the whole call: it runs when at least
            // one event was written to a topic, or was addressed only to disabled topics. An event that an enabled
            // topic dropped does not count, which is what keeps a pure publisher from fanning out (known issue #2).
            let notifyObservers = false;
            for (const { event, targets } of eventTargets) {
                let hasEnabledTarget = false;
                let isWritten = false;
                for (const pubTopic of targets) {
                    if (pubTopic.isDisabled)
                        continue;
                    hasEnabledTarget = true; // This flow is for standard EDA
                    const partitions = new Array();
                    if (event.name === this._nedaClearTrackedKeysEventName) {
                        for (let partition = 0; partition < pubTopic.numPartitions; partition++)
                            partitions.push(partition);
                    }
                    else {
                        // a declared topic gets no special treatment: same rule as a passed one
                        if (!this._manager.eventMap.has(event.name) && !pubTopic.isForce)
                            continue;
                        partitions.push(this._manager.mapToPartition(pubTopic.name, event));
                    }
                    isWritten = true;
                    if (!topicPartitionEvents.has(pubTopic.name))
                        topicPartitionEvents.set(pubTopic.name, new Map());
                    const partitionEvents = topicPartitionEvents.get(pubTopic.name);
                    for (const partition of partitions) {
                        if (!partitionEvents.has(partition))
                            partitionEvents.set(partition, new Array());
                        partitionEvents.get(partition).push(event);
                    }
                }
                if (isWritten || !hasEnabledTarget)
                    notifyObservers = true;
            }
            if (topicPartitionEvents.size > 0) {
                const promises = new Array();
                topicPartitionEvents.forEach((partitionEvents, topicName) => {
                    partitionEvents.forEach((events, partition) => {
                        const producerKey = this._generateKey(topicName, partition);
                        promises.push(this._producers.get(producerKey).produce(...events));
                    });
                });
                // Every topic write is allowed to finish before a failure is reported, so that a rejection never
                // leaves a write from this call still running. A failed call skips the observer fan-out below.
                const results = await Promise.allSettled(promises);
                const failure = results.find((t) => t.status === "rejected");
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
        async subscribeToObservables(observerType, observerId, watches) {
            given(observerType, "observerType").ensureHasValue().ensureIsFunction();
            given(observerId, "observerId").ensureHasValue().ensureIsString();
            given(watches, "watches").ensureHasValue().ensureIsArray();
            if (watches.isEmpty)
                return;
            const observerTypeName = observerType.getTypeName();
            const observerKey = this._generateObserverKey(observerTypeName, observerId);
            const promises = new Array();
            for (const watch of watches) {
                const observableType = watch.observableType.getTypeName();
                const observableEventType = watch.observableEventType.getTypeName();
                const observableKey = this._generateObservableKey(watch);
                // if we want to subscribe, then the handler has to be a registered up front
                const observationKey = EventRegistration.generateObservationKey(observerTypeName, observableType, observableEventType);
                if (!this._manager.observerEventMap.has(observationKey))
                    throw new ApplicationException(`No handler registered for observation key '${observationKey}'`);
                promises.push(new Promise((resolve, reject) => {
                    this._client.sadd(observableKey, observerKey, (err) => {
                        if (err) {
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
        async unsubscribeFromObservables(observerType, observerId, watches) {
            given(observerType, "observerType").ensureHasValue().ensureIsFunction();
            given(observerId, "observerId").ensureHasValue().ensureIsString();
            given(watches, "watches").ensureHasValue().ensureIsArray();
            if (watches.isEmpty)
                return;
            const observerTypeName = observerType.getTypeName();
            const observerKey = this._generateObserverKey(observerTypeName, observerId);
            const promises = new Array();
            for (const watch of watches) {
                const observableKey = this._generateObservableKey(watch);
                promises.push(new Promise((resolve, reject) => {
                    this._client.srem(observableKey, observerKey, (err) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve();
                    }).catch(e => reject(e));
                }));
            }
            await Promise.all(promises);
        }
        async dispose() {
            if (!this._isDisposing) {
                this._isDisposing = true;
                // this._disposePromise = new Promise((resolve, _) => this._client.quit(() => resolve()));
                this._disposePromise = Delay.seconds(ConfigurationManager.getConfig("env") === "dev" ? 2 : 10)
                    .then(() => {
                    this._isDisposed = true;
                });
            }
            await this._disposePromise;
        }
        async _publishToObservers(events) {
            if (this._manager.distributedObserverTopic != null && !this._manager.distributedObserverTopic.isDisabled) {
                const partitionEvents = new Map();
                for (const event of events) {
                    // we know the event type and the observable id (ref id)
                    // what we want to do do is figure if any observer has subscribed to this refId and this eventType
                    // Note: in a multi-tenant system, the refId would include the orgId
                    const observableType = event.refType;
                    const observableId = event.refId;
                    const observableEventType = event.name;
                    const observableKey = this._generateObservableKey({ observableType, observableId, observableEventType });
                    const hasSubs = await this._checkForSubscribers(observableKey);
                    if (hasSubs) {
                        const subs = await this._fetchSubscribers(observableKey);
                        if (subs.isNotEmpty) {
                            for (const sub of subs) {
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
                                const partition = this._manager.mapToPartition(this._manager.distributedObserverTopic.name, distributedObserverEvent);
                                if (!partitionEvents.has(partition))
                                    partitionEvents.set(partition, new Array());
                                partitionEvents.get(partition).push(distributedObserverEvent);
                            }
                        }
                    }
                }
                if (partitionEvents.size === 0)
                    return;
                const promises = new Array();
                partitionEvents.forEach((events, partition) => {
                    const producerKey = this._generateKey(this._manager.distributedObserverTopic.name, partition);
                    promises.push(this._producers.get(producerKey).produce(...events));
                });
                await Promise.all(promises);
            }
        }
        _generateKey(topic, partition) {
            return `${topic}+++${partition}`;
        }
        _generateObservableKey(watch) {
            given(watch, "watch").ensureHasValue().ensureIsObject();
            const observableTypeName = typeof watch.observableType === "string"
                ? watch.observableType : watch.observableType.getTypeName();
            const observableId = watch.observableId;
            const observableEventTypeName = typeof watch.observableEventType === "string"
                ? watch.observableEventType : watch.observableEventType.getTypeName();
            return `n-eda-observable-${observableTypeName}.${observableId}.${observableEventTypeName}`;
        }
        _generateObserverKey(observerTypeName, observerId) {
            given(observerTypeName, "observerTypeName").ensureHasValue().ensureIsString();
            given(observerId, "observerId").ensureHasValue().ensureIsString();
            return `${observerTypeName}.${observerId}`;
        }
        _checkForSubscribers(key) {
            return new Promise((resolve, reject) => {
                this._client.scard(key, (err, val) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(val > 0);
                }).catch(e => reject(e));
            });
        }
        _fetchSubscribers(key) {
            return new Promise((resolve, reject) => {
                this._client.smembers(key, (err, val) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(val ?? []);
                }).catch(e => reject(e));
            });
        }
    };
    return RedisEventBus = _classThis;
})();
export { RedisEventBus };
//# sourceMappingURL=redis-event-bus.js.map