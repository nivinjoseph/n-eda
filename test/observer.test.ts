import { ApplicationException } from "@nivinjoseph/n-exception";
import { Delay } from "@nivinjoseph/n-util";
import { EdaManager, EventBus } from "../src/index.js";
import {
    Customer, Order, OrderShippedEvent, ObserverHistory,
    createObserverEdaManager, observableTopicName, waitFor
} from "./utils/observer-test-utils.js";
import test, { after, before, describe } from "node:test";
import assert from "node:assert";


await describe("distributed observer tests", async () =>
{
    let edaManager: EdaManager;
    let eventBus: EventBus;
    let history: ObserverHistory;

    // event ids are unique per run so the consumer's persisted dedupe window cannot suppress a re-run
    const runId = Date.now().toString();

    before(async () =>
    {
        edaManager = await createObserverEdaManager();

        // the consume loop never resolves; deliberately not awaited
        edaManager.beginConsumption().catch(e => console.error(e));

        eventBus = edaManager.serviceLocator.resolve<EventBus>("EventBus");
        history = edaManager.serviceLocator.resolve<ObserverHistory>("ObserverHistory");
    });

    after(async () =>
    {
        await edaManager.dispose();
    });


    await test("notifies a subscribed observer when the observable publishes", async () =>
    {
        const orderId = `ord_${runId}_1`;
        const customerId = `cust_${runId}_1`;   // must not contain a '.' — the fan-out splits on it
        const eventId = `evt_${runId}_1`;

        await eventBus.subscribeToObservables(Customer, customerId, [
            { observableType: Order, observableId: orderId, observableEventType: OrderShippedEvent }
        ]);

        await eventBus.publish(observableTopicName, new OrderShippedEvent({ id: eventId, orderId }));

        const delivered = await waitFor(() => history.notifications.some(t => t.eventId === eventId));
        assert.ok(delivered, "observer was never notified");

        const notification = history.notifications.find(t => t.eventId === eventId)!;
        assert.strictEqual(notification.observerId, customerId, "observerId does not match the subscriber");
        assert.strictEqual(notification.orderId, orderId, "the observed event was not unwrapped correctly");
    });

    await test("does not notify an observer that is not subscribed to that observable instance", async () =>
    {
        const subscribedOrderId = `ord_${runId}_2a`;
        const otherOrderId = `ord_${runId}_2b`;
        const customerId = `cust_${runId}_2`;
        const eventId = `evt_${runId}_2`;

        await eventBus.subscribeToObservables(Customer, customerId, [
            { observableType: Order, observableId: subscribedOrderId, observableEventType: OrderShippedEvent }
        ]);

        // publish for a DIFFERENT order instance
        await eventBus.publish(observableTopicName, new OrderShippedEvent({ id: eventId, orderId: otherOrderId }));

        await Delay.seconds(6);

        assert.ok(!history.notifications.some(t => t.eventId === eventId),
            "observer was notified about an observable instance it never subscribed to");
    });

    await test("stops notifying after unsubscribe", async () =>
    {
        const orderId = `ord_${runId}_3`;
        const customerId = `cust_${runId}_3`;
        const firstEventId = `evt_${runId}_3a`;
        const secondEventId = `evt_${runId}_3b`;

        const watches = [
            { observableType: Order, observableId: orderId, observableEventType: OrderShippedEvent }
        ];

        await eventBus.subscribeToObservables(Customer, customerId, watches);
        await eventBus.publish(observableTopicName, new OrderShippedEvent({ id: firstEventId, orderId }));

        assert.ok(await waitFor(() => history.notifications.some(t => t.eventId === firstEventId)),
            "observer was not notified while subscribed");

        await eventBus.unsubscribeFromObservables(Customer, customerId, watches);
        await eventBus.publish(observableTopicName, new OrderShippedEvent({ id: secondEventId, orderId }));

        await Delay.seconds(6);

        assert.ok(!history.notifications.some(t => t.eventId === secondEventId),
            "observer was still notified after unsubscribing");
    });

    await test("rejects a subscription with no registered handler for the observation key", async () =>
    {
        // Order-as-observer / Customer-as-observable is the inverse of the registered handler
        await assert.rejects(
            () => eventBus.subscribeToObservables(Order, `obs_${runId}_4`, [
                { observableType: Customer, observableId: "x", observableEventType: OrderShippedEvent }
            ]),
            (error: unknown) =>
            {
                assert.ok(error instanceof ApplicationException, "expected an ApplicationException");
                assert.match(error.message, /No handler registered for observation key/);
                return true;
            });
    });
});
