import { Delay } from "@nivinjoseph/n-util";
import { Redis } from "ioredis";
import assert from "node:assert";
import test, { after, before, describe } from "node:test";
import { EdaEvent, EdaManager, EventBus } from "../src/index.js";
import {
    MessagingHistory, MsgAuditEvent, MsgCustomer, MsgDisabledOnlyObservedEvent, MsgLocalEvent, MsgMisaddressedEvent,
    MsgObservedEvent, MsgOrder, MsgOrderShippedEvent, MsgPlainEvent, MsgToObserverTopicEvent,
    MsgUnwrittenObservedEvent,
    auditTopicName, billingTopicName, createBillingEdaManager, createObservingSenderEdaManager,
    createSenderEdaManager, createShippingEdaManager, notifyTopicName, ordersTopicName, shippingTopicName,
    writeIndexKey
} from "./utils/messaging-test-utils.js";
import { waitFor } from "./utils/observer-test-utils.js";


/**
 * Publishing events that declare their topics with `@topic`. Needs a live Redis.
 *
 * "Written" is asserted on the topic's write index in Redis rather than on a handler having run, because
 * most of these cases are about an event *not* reaching a topic, and a handler that never runs cannot show
 * that on its own.
 */
await describe("topic-addressed publishing tests", async () =>
{
    let sender: EdaManager;
    let billing: EdaManager;
    let shipping: EdaManager;
    let observingSender: EdaManager;
    let eventBus: EventBus;
    let observingEventBus: EventBus;
    let redis: Redis;

    const billingHistory = new MessagingHistory();
    const shippingHistory = new MessagingHistory();

    // event ids are unique per run so the consumers' persisted dedupe windows cannot suppress a re-run
    const runId = Date.now().toString();

    async function written(topicName: string): Promise<number>
    {
        return Number.parseInt(await redis.get(writeIndexKey(topicName)) ?? "0");
    }

    async function writtenToAll(): Promise<Record<string, number>>
    {
        return {
            orders: await written(ordersTopicName),
            billing: await written(billingTopicName),
            shipping: await written(shippingTopicName),
            audit: await written(auditTopicName)
        };
    }

    // the publish signature rules these calls out at compile time; the guards are for a topic that turns out
    // to be unset at runtime, such as one read from configuration
    function untypedPublish(...args: Array<unknown>): Promise<void>
    {
        return (eventBus as unknown as { publish(...args: Array<unknown>): Promise<void>; }).publish(...args);
    }

    function plus(counts: Record<string, number>, changes: Record<string, number>): Record<string, number>
    {
        const result = { ...counts };
        Object.keys(changes).forEach(key => result[key] += changes[key]);
        return result;
    }

    type TopicWriter = { readonly id: string; produce(...events: ReadonlyArray<EdaEvent>): Promise<void>; };

    /**
     * The object a bus hands one topic's writes to (every topic here has a single partition).
     *
     * Reaches past the public API: `publish` gives each write to one of these, and replacing `produce` on it
     * is the only way to make one write fail or finish late without breaking Redis and then waiting out the
     * producer's retry backoff. What is under test is how `publish` waits for these, not the write itself.
     */
    function topicWriter(bus: EventBus, topicName: string): TopicWriter
    {
        const writers = (<any>bus)._producers as Map<string, TopicWriter>;
        const writer = [...writers.values()].find(t => t.id === `{n-eda-${topicName}-0}`);

        assert.ok(writer, `the bus has no producer for topic '${topicName}'`);

        return writer;
    }

    /** Replaces one topic's write, and returns the function that puts the real one back. */
    function replaceWrite(writer: TopicWriter, replacement: () => Promise<void>): () => void
    {
        writer.produce = replacement;

        // the real method lives on the prototype, so removing the own property brings it back
        return (): void => { delete (writer as { produce?: unknown; }).produce; };
    }

    before(async () =>
    {
        redis = new Redis();

        sender = await createSenderEdaManager();
        billing = await createBillingEdaManager(billingHistory);
        shipping = await createShippingEdaManager(shippingHistory);
        observingSender = await createObservingSenderEdaManager();

        // the consume loops never resolve; deliberately not awaited
        billing.beginConsumption().catch(e => console.error(e));
        shipping.beginConsumption().catch(e => console.error(e));

        eventBus = sender.serviceLocator.resolve<EventBus>("EventBus");
        observingEventBus = observingSender.serviceLocator.resolve<EventBus>("EventBus");
    });

    after(async () =>
    {
        await Promise.all([sender.dispose(), billing.dispose(), shipping.dispose(), observingSender.dispose()]);
        await redis.quit();
    });


    await test("delivers an event published without a topic to each service that owns a declared topic", async () =>
    {
        const eventId = `evt_${runId}_declared`;
        const before = await writtenToAll();

        await eventBus.publish(new MsgOrderShippedEvent({ id: eventId }));

        assert.deepStrictEqual(await writtenToAll(), plus(before, { billing: 1, shipping: 1 }));
        assert.ok(await waitFor(() => billingHistory.count(eventId) === 1 && shippingHistory.count(eventId) === 1));
    });

    await test("writes an event once to a topic that is both passed and declared", async () =>
    {
        const eventId = `evt_${runId}_both`;
        const before = await writtenToAll();

        await eventBus.publish(billingTopicName, new MsgOrderShippedEvent({ id: eventId }));

        assert.deepStrictEqual(await writtenToAll(), plus(before, { billing: 1, shipping: 1 }));
    });

    await test("adds the passed topic to the declared ones, under the usual no-handler rule", async () =>
    {
        const eventId = `evt_${runId}_extra`;
        const before = await writtenToAll();

        // msg-orders is not force-published and the sender has no handler, so that copy is dropped
        await eventBus.publish(ordersTopicName, new MsgOrderShippedEvent({ id: eventId }));
        // msg-audit is force-published, so that copy is written
        await eventBus.publish(auditTopicName, new MsgOrderShippedEvent({ id: `${eventId}_forced` }));

        assert.deepStrictEqual(await writtenToAll(), plus(before, { billing: 2, shipping: 2, audit: 1 }));
    });

    await test("drops an event on a declared topic that is not force-published when no handler is registered",
        async () =>
        {
            const before = await writtenToAll();

            await eventBus.publish(new MsgLocalEvent({ id: `evt_${runId}_local` }));

            assert.deepStrictEqual(await writtenToAll(), before);
        });

    await test("runs a handler once per topic when a service subscribes to two of an event's topics", async () =>
    {
        const eventId = `evt_${runId}_audit`;

        await eventBus.publish(new MsgAuditEvent({ id: eventId }));

        assert.ok(await waitFor(() => billingHistory.count(eventId) === 2));
    });

    await test("writes a message to a service that has no handler for it, where it is skipped", async () =>
    {
        const auditEventId = `evt_${runId}_unhandled`;
        const followUpEventId = `evt_${runId}_follow_up`;
        const before = await writtenToAll();

        await eventBus.publish(shippingTopicName, new MsgAuditEvent({ id: auditEventId }));
        await eventBus.publish(new MsgOrderShippedEvent({ id: followUpEventId }));

        assert.deepStrictEqual(await writtenToAll(), plus(before, { billing: 2, shipping: 2, audit: 1 }));

        // the topic has one partition, so the follow-up being handled means the audit event was passed over
        assert.ok(await waitFor(() => shippingHistory.count(followUpEventId) === 1));
        assert.strictEqual(shippingHistory.count(auditEventId), 0);
    });

    await test("sends each event of a mixed batch to its own topics", async () =>
    {
        const shippedEventId = `evt_${runId}_mixed_shipped`;
        const plainEventId = `evt_${runId}_mixed_plain`;
        const before = await writtenToAll();

        await eventBus.publish(billingTopicName,
            new MsgOrderShippedEvent({ id: shippedEventId }), new MsgPlainEvent({ id: plainEventId }));

        assert.deepStrictEqual(await writtenToAll(), plus(before, { billing: 1, shipping: 1 }));
        assert.ok(await waitFor(() =>
            billingHistory.count(shippedEventId) === 1 && billingHistory.count(plainEventId) === 1
            && shippingHistory.count(shippedEventId) === 1));
        assert.strictEqual(shippingHistory.count(plainEventId), 0);
    });

    await test("rejects an event that has neither a passed nor a declared topic", async () =>
    {
        await assert.rejects(() => eventBus.publish(new MsgPlainEvent({ id: `evt_${runId}_nowhere` })),
            /'MsgPlainEvent' has no topic/);
    });

    await test("rejects an event that declares an unregistered topic, before writing to any topic", async () =>
    {
        const before = await writtenToAll();

        await assert.rejects(
            () => eventBus.publish(
                new MsgOrderShippedEvent({ id: `evt_${runId}_valid` }),
                new MsgMisaddressedEvent({ id: `evt_${runId}_misaddressed` })),
            /'msg-unregistered' declared on event 'MsgMisaddressedEvent' must be a registered topic/);

        assert.deepStrictEqual(await writtenToAll(), before);
    });

    await test("names the topic when the first argument to publish is missing", async () =>
    {
        await assert.rejects(
            () => untypedPublish(undefined, new MsgOrderShippedEvent({ id: `evt_${runId}_unset_topic` })),
            /Argument 'topic or first event' is NULL/);
    });

    await test("rejects a first argument to publish that is neither a topic name nor an event", async () =>
    {
        await assert.rejects(
            () => untypedPublish(5, new MsgOrderShippedEvent({ id: `evt_${runId}_bad_first_argument` })),
            /Argument 'topic or first event' must be a topic name or an event/);
    });

    await test("still rejects a passed topic that is not registered", async () =>
    {
        await assert.rejects(
            () => eventBus.publish("msg-unregistered", new MsgOrderShippedEvent({ id: `evt_${runId}_bad_topic` })),
            /must be registered topic/);
    });

    await test("skips a declared topic that the publishing service registered as disabled", async () =>
    {
        const before = await writtenToAll();

        await observingEventBus.publish(new MsgOrderShippedEvent({ id: `evt_${runId}_disabled` }));

        assert.deepStrictEqual(await writtenToAll(), plus(before, { shipping: 1 }));
    });

    await test("rejects an event that declares the distributed observer topic", async () =>
    {
        await assert.rejects(
            () => observingEventBus.publish(new MsgToObserverTopicEvent({ id: `evt_${runId}_to_observer` })),
            /must not publish directly to distributed observer topic/);
    });

    await test("notifies an observer once for an event written to two topics", async () =>
    {
        const orderId = `ord_${runId}`;
        const before = await written(notifyTopicName);

        await observingEventBus.subscribeToObservables(MsgCustomer, `cust_${runId}`, [
            { observableType: MsgOrder, observableId: orderId, observableEventType: MsgObservedEvent }
        ]);

        await observingEventBus.publish(new MsgObservedEvent({ id: `evt_${runId}_observed`, refId: orderId }));

        assert.strictEqual(await written(notifyTopicName), before + 1);
    });

    await test("does not notify observers when the only enabled topic dropped the event", async () =>
    {
        const orderId = `ord_${runId}_unwritten`;
        const notifiedBefore = await written(notifyTopicName);
        const before = await writtenToAll();

        await observingEventBus.subscribeToObservables(MsgCustomer, `cust_${runId}_unwritten`, [
            { observableType: MsgOrder, observableId: orderId, observableEventType: MsgUnwrittenObservedEvent }
        ]);

        // msg-orders is enabled but not force-published, and msg-billing is disabled: nothing is written,
        // and an event that an enabled topic dropped does not trigger the observer fan-out (known issue #2)
        await observingEventBus.publish(
            new MsgUnwrittenObservedEvent({ id: `evt_${runId}_unwritten`, refId: orderId }));

        assert.deepStrictEqual(await writtenToAll(), before);
        assert.strictEqual(await written(notifyTopicName), notifiedBefore);
    });

    await test("notifies observers of an event addressed only to disabled topics", async () =>
    {
        const orderId = `ord_${runId}_disabled_only`;
        const notifiedBefore = await written(notifyTopicName);
        const before = await writtenToAll();

        await observingEventBus.subscribeToObservables(MsgCustomer, `cust_${runId}_disabled_only`, [
            { observableType: MsgOrder, observableId: orderId, observableEventType: MsgDisabledOnlyObservedEvent }
        ]);

        // msg-billing is disabled on this sender, so the event is written nowhere; with no enabled target
        // at all, the observer fan-out still runs
        await observingEventBus.publish(
            new MsgDisabledOnlyObservedEvent({ id: `evt_${runId}_disabled_only`, refId: orderId }));

        assert.deepStrictEqual(await writtenToAll(), before);
        assert.strictEqual(await written(notifyTopicName), notifiedBefore + 1);
    });

    await test("notifies observers of a disabled-only event when another event in the call is dropped", async () =>
    {
        const orderId = `ord_${runId}_batched`;
        const notifiedBefore = await written(notifyTopicName);
        const before = await writtenToAll();

        await observingEventBus.subscribeToObservables(MsgCustomer, `cust_${runId}_batched`, [
            { observableType: MsgOrder, observableId: orderId, observableEventType: MsgDisabledOnlyObservedEvent }
        ]);

        // the first event is dropped on msg-orders (enabled, not force-published, no handler); that must not
        // cancel the notification the second event would have produced on its own
        await observingEventBus.publish(
            new MsgLocalEvent({ id: `evt_${runId}_batched_local` }),
            new MsgDisabledOnlyObservedEvent({ id: `evt_${runId}_batched`, refId: orderId }));

        assert.deepStrictEqual(await writtenToAll(), before);
        assert.strictEqual(await written(notifyTopicName), notifiedBefore + 1);
    });

    await test("rejects only after every topic write has finished", async () =>
    {
        let billingWriteFinished = false;

        const restoreBilling = replaceWrite(topicWriter(eventBus, billingTopicName), async () =>
        {
            await Delay.milliseconds(200);
            billingWriteFinished = true;
        });
        const restoreShipping = replaceWrite(topicWriter(eventBus, shippingTopicName),
            () => Promise.reject(new Error("simulated write failure")));

        try
        {
            // the shipping write fails at once while the billing write is still running; a caller must not
            // be told the publish failed until nothing from it is still in flight
            await assert.rejects(
                () => eventBus.publish(new MsgOrderShippedEvent({ id: `evt_${runId}_slow_and_failed` })),
                /simulated write failure/);

            assert.strictEqual(billingWriteFinished, true);
        }
        finally
        {
            restoreBilling();
            restoreShipping();
        }
    });

    await test("does not notify observers when a topic write fails", async () =>
    {
        const orderId = `ord_${runId}_failed_write`;
        const notifiedBefore = await written(notifyTopicName);
        const auditBefore = await written(auditTopicName);

        await observingEventBus.subscribeToObservables(MsgCustomer, `cust_${runId}_failed_write`, [
            { observableType: MsgOrder, observableId: orderId, observableEventType: MsgObservedEvent }
        ]);

        const restoreShipping = replaceWrite(topicWriter(observingEventBus, shippingTopicName),
            () => Promise.reject(new Error("simulated write failure")));

        try
        {
            await assert.rejects(
                () => observingEventBus.publish(
                    new MsgObservedEvent({ id: `evt_${runId}_failed_write`, refId: orderId })),
                /simulated write failure/);
        }
        finally
        {
            restoreShipping();
        }

        // the event did reach msg-audit, and the call still rejected: no observer is told about it
        assert.ok(await waitFor(async () => await written(auditTopicName) === auditBefore + 1));
        assert.strictEqual(await written(notifyTopicName), notifiedBefore);
    });
});
