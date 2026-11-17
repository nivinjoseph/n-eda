import "@nivinjoseph/n-ext";
import { EdaEvent } from "./eda-event.js";
/**
 * Metadata key under which `@topic` stores the topic names declared on an event class.
 *
 * Note: a `Symbol.for` key, so it is identical across duplicate copies of this package.
 */
export declare const eventTopicsSymbol: unique symbol;
/**
 * Declares, on an **event class**, the topics every instance of that event is published to. This is what
 * gives an event an address: `EventBus.publish` writes the event to each declared topic, in addition to
 * the explicit topic when one is passed, so the call site no longer has to name the destination.
 *
 * Contract: a **standard (ES2023+) class decorator** that writes into `context.metadata`, which requires
 * `Symbol.metadata` to exist; the package barrel polyfills it at import time. It can sit above or below
 * n-util's `@serialize("Namespace")`.
 *
 * RULE: every service that publishes the event must register **every** declared topic with
 * `EdaManager.registerTopics(...)`, using the same `numPartitions` and TTL as the service that consumes it —
 * `publish` throws for a declared topic that is not registered. Register a topic with `.disable()` to opt a
 * service out of writing to it.
 *
 * RULE: a declared topic gets no special treatment at publish time. An event with no handler registered on
 * the publishing manager is still **silently dropped** on any topic that was not `.forcePublish()`ed, so a
 * service that only sends the event needs `.forcePublish()` on each destination topic.
 *
 * RULE: a service that subscribes to more than one of an event's topics runs its handler once per topic —
 * handlers are found by event name and duplicates are suppressed per topic, not across topics.
 *
 * Note: a subclass inherits its parent's topics unless it declares its own, which **replace** the
 * parent's rather than adding to them. The decorator may therefore sit on an abstract base event class.
 *
 * @param topicNames - one or more topic names; each is trimmed and must match a registered `Topic.name`
 * exactly (the lookup is case-sensitive)
 * @returns the class decorator
 * @throws if no names are given, a name is missing or not a string, or a name is repeated
 * @throws when applied to anything other than a class, or more than once to the same class
 *
 * @example
 * ```typescript
 * @topic("billing", "shipping")
 * @serialize("MyApp")
 * export class OrderShippedEvent extends Serializable implements EdaEvent { }
 *
 * await eventBus.publish(new OrderShippedEvent({ ... }));            // billing + shipping
 * await eventBus.publish("orders", new OrderShippedEvent({ ... }));  // orders + billing + shipping
 * ```
 */
export declare function topic(...topicNames: [string, ...Array<string>]): EventTopicDecorator;
/**
 * An event class that `@topic` can be applied to — concrete or abstract.
 */
export type EventTopicTarget = abstract new (...args: Array<any>) => EdaEvent;
/**
 * The class decorator returned by {@link topic}.
 */
export type EventTopicDecorator = (target: EventTopicTarget, context: ClassDecoratorContext<EventTopicTarget>) => void;
/**
 * Reads the topic names declared on an event's class with `@topic`. Internal — used by the event bus to
 * resolve where an event goes; not exported from the package barrel.
 *
 * @param event - the event instance being published
 * @returns the declared topic names, or an empty list when the event's class is not decorated
 */
export declare function getEventTopics(event: EdaEvent): ReadonlyArray<string>;
//# sourceMappingURL=event-topic.d.ts.map