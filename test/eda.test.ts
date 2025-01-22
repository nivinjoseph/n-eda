import { Delay, TypeHelper } from "@nivinjoseph/n-util";
import { EdaEvent, EdaManager, EventBus } from "../src/index.js";
import { createEdaManager, EventHistory, TestEvent } from "./utils/eda-test-utils.js";
import test, { after, before, describe } from "node:test";
import assert from "node:assert";


await describe("eda tests", async () =>
{
    let edaManager: EdaManager;

    before(() =>
    {
        edaManager = createEdaManager();
    });

    after(async () =>
    {
        await edaManager.dispose();
    });

    // test("basic", async () =>
    // {
    //     // @ts-ignore
    //     const consumePromise = edaManager.beginConsumption();
    //     const eventBus = edaManager.serviceLocator.resolve<EventBus>("EventBus");
    //     const history = edaManager.serviceLocator.resolve<EventHistory>("EventHistory");
    //     const testEvent = new TestEvent({ id: "1-foo" });
    //     const eventIds = [testEvent.id];

    //     await eventBus.publish("basic", testEvent);

    //     await Delay.seconds(2);

    //     // Assert.ok(history.records.length === 1 && history.records[0] === testEvent.id);

    //     Assert.strictEqual(history.records.length, 1, "number of records don't match");
    //     Assert.deepStrictEqual(history.records, eventIds, "eventIds don't match");
    // });


    await test("basic", async () =>
    {
        // @ts-expect-error: not used
        const consumePromise = edaManager.beginConsumption();
        const eventBus = edaManager.serviceLocator.resolve<EventBus>("EventBus");
        const history = edaManager.serviceLocator.resolve<EventHistory>("EventHistory");
        const testEvents = new Array<EdaEvent>();

        for (let i = 0; i < 100; i++)
        {
            for (let j = 0; j < 100; j++)
            {
                const event = new TestEvent({ id: `test_${i}-evt_${j}` });
                testEvents.push(event);
            }
        }

        // const numbers = testEvents.map(t => Number.parseInt(t.id.split("-")[1].split("_")[1]));

        history.startProfiling();
        await eventBus.publish("basic", ...testEvents);

        await Delay.seconds(10);

        // await Delay.seconds(1);

        // await edaManager.dispose();

        // await Delay.seconds(10);



        console.log(`EDA time => ${history.endProfiling()}ms`);

        // Assert.ok(history.records.length === 1 && history.records[0] === testEvent.id);

        // const historyIds = history.records.groupBy(t => t.split("-")[0]).reduce((acc, t) =>
        // {
        //     acc.push(...t.values);
        //     return acc;
        // }, new Array<string>());

        // const historyNumbers = historyIds.map(t => Number.parseInt(t.split("-")[1].split("_")[1]));

        assert.strictEqual(history.records.length, testEvents.length * 2, "number of records don't match");

        for (let i = 0; i < 100; i++)
        {
            const eventsForPartition = history.records.where(t => t.split("-").takeFirst() === `test_${i}`);
            const ordered = eventsForPartition
                .orderBy(t => TypeHelper.parseNumber(t.split("-").takeLast().split("_").takeLast()));

            assert.deepStrictEqual(eventsForPartition, ordered, "ordering is incorrect");
        }

        // console.log(historyIds);
        // Assert.deepStrictEqual(historyIds, testEvents.map(t => t.id), "eventIds don't match");
        // Assert.deepStrictEqual(historyNumbers, numbers, "numbers don't match");
    });

    // test("ordering", async () =>
    // {

    // });
});