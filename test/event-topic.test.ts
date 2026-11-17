import { Deserializer, Serializable, serialize } from "@nivinjoseph/n-util";
import assert from "node:assert";
import test, { describe } from "node:test";
import { EdaEvent, EventBus, topic } from "../src/index.js";
import { getEventTopics } from "../src/event-topic.js";


/**
 * The `@topic` decorator on its own: what it stores on an event class and what it rejects. These need no
 * Redis — publishing to the declared topics is covered by `messaging.test.ts`.
 */
abstract class TopicTestEvent extends Serializable implements EdaEvent
{
    private readonly _id: string;


    @serialize
    public get id(): string { return this._id; }

    @serialize
    public get name(): string { return (<Object>this).getTypeName(); }

    public get partitionKey(): string { return this._id; }
    public get refId(): string { return "neda"; }
    public get refType(): string { return "neda"; }


    public constructor(data: { id: string; })
    {
        super(data);

        this._id = data.id;
    }
}

@topic("billing", "shipping")
@serialize("TopicTest")
class TwoTopicEvent extends TopicTestEvent { }

@serialize("TopicTest")
@topic("billing")
class TopicBelowSerializeEvent extends TopicTestEvent { }

@topic("  billing  ")
@serialize("TopicTest")
class PaddedTopicEvent extends TopicTestEvent { }

@serialize("TopicTest")
class NoTopicEvent extends TopicTestEvent { }

@serialize("TopicTest")
class InheritingEvent extends TwoTopicEvent { }

@topic("audit")
@serialize("TopicTest")
class OverridingEvent extends TwoTopicEvent { }

@topic("billing")
abstract class AbstractBillingEvent extends TopicTestEvent { }

@serialize("TopicTest")
class ConcreteBillingEvent extends AbstractBillingEvent { }


await describe("topic decorator tests", async () =>
{
    // the decorator's own signature rules these calls out at compile time; the guards are for untyped callers
    const untypedTopic = topic as unknown as (...topicNames: Array<unknown>) => unknown;

    await test("stores the declared topic names on the event class", () =>
    {
        assert.deepStrictEqual(getEventTopics(new TwoTopicEvent({ id: "1" })), ["billing", "shipping"]);
    });

    await test("trims the declared topic names", () =>
    {
        assert.deepStrictEqual(getEventTopics(new PaddedTopicEvent({ id: "1" })), ["billing"]);
    });

    await test("reports no topics for an event class that is not decorated", () =>
    {
        assert.deepStrictEqual(getEventTopics(new NoTopicEvent({ id: "1" })), []);
    });

    await test("reports no topics for an event that has no constructor", () =>
    {
        const event = Object.assign(Object.create(null) as object, { id: "1", name: "BareEvent" });

        assert.deepStrictEqual(getEventTopics(event as unknown as EdaEvent), []);
    });

    await test("does not let a caller change the declared topics", () =>
    {
        const topics = getEventTopics(new TwoTopicEvent({ id: "1" }));

        assert.throws(() => (<Array<string>>topics).push("audit"), TypeError);
        assert.deepStrictEqual(getEventTopics(new TwoTopicEvent({ id: "2" })), ["billing", "shipping"]);
    });

    await test("gives a subclass its parent's topics", () =>
    {
        assert.deepStrictEqual(getEventTopics(new InheritingEvent({ id: "1" })), ["billing", "shipping"]);
    });

    await test("replaces the parent's topics when a subclass declares its own", () =>
    {
        assert.deepStrictEqual(getEventTopics(new OverridingEvent({ id: "1" })), ["audit"]);
        assert.deepStrictEqual(getEventTopics(new TwoTopicEvent({ id: "1" })), ["billing", "shipping"]);
    });

    await test("can be declared on an abstract base event class", () =>
    {
        assert.deepStrictEqual(getEventTopics(new ConcreteBillingEvent({ id: "1" })), ["billing"]);
    });

    await test("leaves serialization working when placed above the serialize decorator", () =>
    {
        const event = new TwoTopicEvent({ id: "evt-1" });

        const deserialized = Deserializer.deserialize<TwoTopicEvent>(event.serialize());

        assert.ok(deserialized instanceof TwoTopicEvent);
        assert.strictEqual(deserialized.id, "evt-1");
        assert.strictEqual(deserialized.name, "TwoTopicEvent");
    });

    await test("works when placed below the serialize decorator", () =>
    {
        const event = new TopicBelowSerializeEvent({ id: "evt-1" });

        const deserialized = Deserializer.deserialize<TopicBelowSerializeEvent>(event.serialize());

        assert.ok(deserialized instanceof TopicBelowSerializeEvent);
        assert.deepStrictEqual(getEventTopics(deserialized), ["billing"]);
    });

    await test("rejects being given no topic names", () =>
    {
        assert.throws(() => untypedTopic(), /topicNames/);
    });

    await test("rejects an empty topic name", () =>
    {
        assert.throws(() => topic("billing", "   "), /topicName/);
    });

    await test("rejects a topic name that is not a string", () =>
    {
        assert.throws(() => untypedTopic("billing", 5), /topicName/);
    });

    await test("rejects the same topic name given twice", () =>
    {
        assert.throws(() => topic("billing", " billing "), /duplicate topic names/);
    });

    await test("rejects being applied to something other than a class", () =>
    {
        const decorator = topic("billing") as unknown as (target: unknown, context: unknown) => void;

        assert.throws(() => decorator(function (): void { /* a method */ }, { kind: "method", metadata: {} }),
            /topic decorator should only be used on a class/);
    });

    await test("rejects being applied twice to one class", () =>
    {
        assert.throws(() =>
        {
            @topic("billing")
            @topic("shipping")
            @serialize("TopicTest")
            class TwiceDecoratedEvent extends TopicTestEvent { }

            return TwiceDecoratedEvent;
        }, /topic decorator should only be applied once/);
    });

    await test("keeps the original publish signature visible to type utilities", () =>
    {
        // A compile-time check. Type utilities and typed mocks read the last overload of a method, so the
        // next line stops compiling if `publish(topic, ...events)` is not declared last on `EventBus`.
        const args: Parameters<EventBus["publish"]> = ["orders"];

        assert.deepStrictEqual(args, ["orders"]);
    });
});
