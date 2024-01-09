import { Make, Uuid } from "@nivinjoseph/n-util";
import MurmurHash from "murmurhash3js";
import assert from "node:assert";
import test, { describe } from "node:test";


await describe("Partitioning tests", async () =>
{
    const numPartitions = 1000;

    const partitionMapper = (partitionKey: string): number =>
    {
        return MurmurHash.x86.hash32(partitionKey) % numPartitions;
    };

    await test("basics", () =>
    {
        // generate 1000 ids with prefix
        // map each id to partition
        // group by partition
        // log

        const ids = new Array<string>();
        Make.loop(() =>
        {
            ids.push(`rti_${Uuid.create().replaceAll("-", "")}`);
        }, 100);

        console.log(ids[0]);

        const grouped = ids.groupBy(t => partitionMapper(t).toString());

        console.log("total groups", grouped.length);

        grouped.orderByDesc(t => t.values.length).forEach((item) =>
        {
            console.log(item.key, item.values.length);
        });

        assert.ok(true);
    });


});