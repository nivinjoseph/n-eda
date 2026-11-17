import { EdaEvent } from "./eda-event.js";
import { Disposable } from "@nivinjoseph/n-util";
import { EdaManager } from "./eda-manager.js";
/**
 * The publishing half of n-eda, and the entry point for distributed-observer subscriptions.
 * `RedisEventBus` is the only shipped implementation.
 *
 * Contract: register the class (not an instance) with `EdaManager.registerEventBus(RedisEventBus)` so the
 * container can inject its dependencies — this registration is **mandatory**; `bootstrap()` fails without
 * it. Resolve the bus with `manager.serviceLocator.resolve<EventBus>("EventBus")`, or `@inject("EventBus")`
 * it into a handler that needs to publish downstream.
 */
export interface EventBus extends Disposable {
    /**
     * Wires this bus to its manager. Called by `EdaManager.bootstrap()` — never call it yourself.
     *
     * @param manager - the bootstrapping manager
     * @throws if already initialized, or if the manager has been disposed
     */
    initialize(manager: EdaManager): void;
    /**
     * Publishes one or more events to the topics their classes declare with `@topic`, without naming a
     * topic at the call site. Events in one call may go to different sets of topics. The rules on
     * {@link EventBus.publish | the form that takes a topic} apply unchanged.
     *
     * @param events - the events to publish; an empty list is a no-op
     * @throws if an event's class declares no topics, in addition to everything the other form throws
     */
    publish(...events: ReadonlyArray<EdaEvent>): Promise<void>;
    /**
     * Publishes one or more events to a topic, and to every topic each event's class declares with
     * `@topic`. Events are bucketed by partition and each partition's batch is written as a single
     * compressed Redis entry per topic. A topic that is both passed and declared is written once.
     *
     * RULE: an event whose `name` has no handler registered on **this** manager is **silently dropped**
     * on any topic that was not configured with `.forcePublish()` — declared topics included. A service
     * that only emits events it does not itself consume publishes nothing until you do that. This is the
     * sharpest edge in the library.
     *
     * RULE: every target topic is validated before anything is written, but the writes are independent.
     * One topic can be written while another fails, in which case this rejects once every topic write has
     * finished; a retry re-sends to the topics that already succeeded. Observers are notified only after
     * every write has succeeded, so a call that rejects notifies none of them.
     *
     * Note: `topic` must exactly match a registered `Topic.name`; the lookup is case-sensitive even though
     * duplicate-name detection is not.
     *
     * @param topic - the registered topic name to publish to
     * @param events - the events to publish; an empty list is a no-op
     * @throws if the bus is not initialized, the topic or a declared topic is not registered or is the
     * distributed observer topic, an event lacks a string `id`/`name`, or the bus has been disposed
     */
    publish(topic: string, ...events: ReadonlyArray<EdaEvent>): Promise<void>;
    /**
     * Registers this observer instance to receive events from specific observable instances.
     *
     * Contract: a matching observer handler — one carrying `@observer(observerType)`,
     * `@observable(watch.observableType)`, and `@observedEvent(watch.observableEventType)` — must already
     * be registered on this manager, because the subscription is validated against the observation key.
     *
     * @param observerType - the class of the entity doing the watching
     * @param observerId - the id of the specific observer instance
     * @param watches - the observable instances and event types to watch
     * @throws `ApplicationException` if no handler is registered for a watch's observation key
     */
    subscribeToObservables(observerType: Function, observerId: string, watches: ReadonlyArray<ObservableWatch>): Promise<void>;
    /**
     * Removes subscriptions previously created by {@link EventBus.subscribeToObservables}. Unsubscribing
     * from a watch that was never subscribed is a no-op.
     *
     * @param observerType - the class of the entity doing the watching
     * @param observerId - the id of the specific observer instance
     * @param watches - the observable instances and event types to stop watching
     */
    unsubscribeFromObservables(observerType: Function, observerId: string, watches: ReadonlyArray<ObservableWatch>): Promise<void>;
}
/**
 * Identifies one observable instance and one event type on it, for
 * {@link EventBus.subscribeToObservables}.
 *
 * Contract: `observableType` must resolve to the same type name as the published event's `refType`, and
 * `observableId` to its `refId` — that pairing is what the fan-out matches subscribers against.
 */
export type ObservableWatch = {
    /** The class of the entity emitting the event — must match the event's `refType`. */
    observableType: Function | string;
    /** The id of the specific observable instance to watch — must match the event's `refId`. */
    observableId: string;
    /** The class of the event to watch for on that instance. */
    observableEventType: Function | string;
};
//# sourceMappingURL=event-bus.d.ts.map