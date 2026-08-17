import { ClassDefinition, Serializable } from "@nivinjoseph/n-util";

/**
 * The contract every event published through n-eda must satisfy.
 *
 * Contract: implementations must extend `Serializable` from `@nivinjoseph/n-util`, carry a class-level
 * `@serialize("Namespace")`, and apply a property-level `@serialize` to **both** `id` and `name`. The
 * wire format is `serialize()`'s output; the consumer reconstructs the event with n-util's
 * `Deserializer`, which throws for a type it has never seen. `partitionKey`, `refId`, and `refType` are
 * derived on both sides and must NOT be serialized.
 *
 * RULE: the event class name is a persisted identity — it is the `$typename` discriminator that routes
 * the event to a handler. Renaming an event class breaks deserialization of every event of that type
 * already in flight.
 *
 * @example
 * ```typescript
 * @serialize("MyApp")
 * export class UserCreatedEvent extends Serializable implements EdaEvent
 * {
 *     @serialize public get id(): string { return this._id; }
 *     @serialize public get name(): string { return (<Object>UserCreatedEvent).getTypeName(); }
 *     public get partitionKey(): string { return this._userId; }
 *     public get refId(): string { return this._userId; }
 *     public get refType(): string { return "User"; }
 * }
 * ```
 */
// public
export interface EdaEvent extends Serializable
{
    /** Unique id for this event instance. Serialized; used as the deduplication key by consumers. */
    get id(): string;

    /**
     * The event's type name, conventionally `(<Object>MyEvent).getTypeName()`. Serialized; the consumer
     * routes on this value, so a handler is found only when it matches the registered event class name.
     */
    get name(): string;

    /**
     * The ordering key. Events sharing a partition key are processed one at a time, in order, across the
     * whole fleet; different keys process concurrently. Also determines the Redis partition via
     * `murmurhash3 x86 hash32(partitionKey) % numPartitions`. Not serialized.
     */
    get partitionKey(): string;

    /**
     * Id of the instance that emitted this event. Only meaningful for the distributed observer, where it
     * identifies the observable being watched. Still required by the interface — return a stable
     * constant if you do not use observers. Not serialized.
     */
    get refId(): string;

    /**
     * Type name of the instance that emitted this event. For the distributed observer this must equal the
     * observable type's name, or the consumer's observation-key lookup will miss. Not serialized.
     */
    get refType(): string;
}

/**
 * A constructable `EdaEvent` type — what the `@event(...)` and `@observedEvent(...)` decorators accept.
 *
 * @typeParam TEvent - the event type this class produces
 */
export type EdaEventClass<TEvent extends EdaEvent> = ClassDefinition<TEvent>; 