import { EdaEvent } from "../eda-event.js";
import { EdaManager } from "../eda-manager.js";
import { EventBus, ObservableWatch } from "../event-bus.js";
import { Redis } from "ioredis";
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
export declare class RedisEventBus implements EventBus {
    private readonly _nedaClearTrackedKeysEventName;
    private readonly _client;
    private readonly _producers;
    private _isDisposing;
    private _isDisposed;
    private _disposePromise;
    private _manager;
    private _logger;
    /**
     * @param redisClient - injected from the DI key `"EdaRedisClient"`; shared with every producer and
     * consumer in the process
     */
    constructor(redisClient: Redis);
    /**
     * Binds the bus to its manager and creates one `Producer` per partition of every enabled topic.
     *
     * Called by `EdaManager.bootstrap()` — never call it yourself.
     *
     * @param manager - the bootstrapping manager
     * @throws `ObjectDisposedException` if already disposed
     * @throws if the manager is missing or not an `EdaManager`, or if already initialized
     */
    initialize(manager: EdaManager): void;
    /**
     * Publishes events to the topics their classes declare with `@topic`, without naming a topic at the
     * call site. Everything documented on the form that takes a topic applies here too; see
     * `EventBus.publish` for the full contract.
     *
     * @param events - the events to publish; an empty list is a no-op
     * @throws if an event's class declares no topics, in addition to everything the other form throws
     */
    publish(...events: ReadonlyArray<EdaEvent>): Promise<void>;
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
    publish(topic: string, ...events: ReadonlyArray<EdaEvent>): Promise<void>;
    subscribeToObservables(observerType: Function, observerId: string, watches: ReadonlyArray<ObservableWatch>): Promise<void>;
    unsubscribeFromObservables(observerType: Function, observerId: string, watches: ReadonlyArray<ObservableWatch>): Promise<void>;
    dispose(): Promise<void>;
    private _publishToObservers;
    private _generateKey;
    private _generateObservableKey;
    private _generateObserverKey;
    private _checkForSubscribers;
    private _fetchSubscribers;
}
//# sourceMappingURL=redis-event-bus.d.ts.map