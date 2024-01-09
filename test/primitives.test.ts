import { Duration, Make } from "@nivinjoseph/n-util";
import { Queue } from "../src/redis-implementation/queue.js";
import test, { describe } from "node:test";
import assert from "node:assert";


await describe("Primitives tests", async () =>
{
    await test("Queue", () =>
    {
        const items = [1, 2, 3, 4, 5];

        const queue = new Queue<number>();

        // const result = [null, ...items, null];

        const result = new Array<number | null>();

        result.push(queue.dequeue());

        items.forEach(t => queue.enqueue(t));

        Make.loop(() => result.push(queue.dequeue()), items.length);

        result.push(queue.dequeue());

        console.log(JSON.stringify(result));
        assert.deepStrictEqual(result, [null, ...items, null]);
    });

    await test("Queue performance tests", () =>
    {
        const arrayQueue = new Array<number>();

        let start = Date.now();

        for (let i = 0; i < 10000; i++)
            arrayQueue.unshift(i);

        while (arrayQueue.length > 0)
            arrayQueue.pop();

        let end = Date.now();

        console.log(`Array time => ${end - start}ms`);


        const customQueue = new Queue<number>();

        start = Date.now();

        for (let i = 0; i < 10000; i++)
            customQueue.enqueue(i);

        while (arrayQueue.length > 0)
            customQueue.dequeue();

        end = Date.now();

        console.log(`Queue time => ${end - start}ms`);


        assert.ok(true);
    });

    await test("Num partition events", () =>
    {
        const now = Date.now();
        const fiftyYears = Duration.fromHours(24 * 366 * 50).toMilliSeconds();

        const maxValue = Number.MAX_SAFE_INTEGER;

        assert.ok(((now + fiftyYears) * 1000) < maxValue);
    });
});