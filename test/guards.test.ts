import { Duration } from "@nivinjoseph/n-util";
import { EdaManager, GrpcEventHandler, RedisEventBus, RedisEventSubMgr, Topic } from "../src/index.js";
import test, { describe } from "node:test";
import assert from "node:assert";


/**
 * Bootstrap-time configuration guards. These need no Redis: every assertion below is rejected by the
 * `given(...)` chain at the top of `bootstrap()`, before the container is bootstrapped or the event bus is
 * resolved.
 */
await describe("bootstrap guard tests", async () =>
{
    function baseManager(): EdaManager
    {
        return new EdaManager()
            .registerTopics(new Topic("guard", Duration.fromHours(1), 5))
            .registerEventBus(RedisEventBus);
    }


    await test("rejects being both event subscriber and grpc consumer", async () =>
    {
        const edaManager = baseManager()
            .registerEventSubscriptionManager(RedisEventSubMgr, "guard-group")
            .actAsGrpcConsumer(new GrpcEventHandler());

        await assert.rejects(() => edaManager.bootstrap(),
            /cannot be both event subscriber and grpc consumer/);
    });

    await test("rejects being both lambda consumer and grpc consumer", async () =>
    {
        const edaManager = baseManager()
            .actAsGrpcConsumer(new GrpcEventHandler());

        // reach past the public API: actAsAwsLambdaConsumer requires an AwsLambdaEventHandler instance, and
        // the flag is all the guard reads.
        (<any>edaManager)._isAwsLambdaConsumer = true;

        await assert.rejects(() => edaManager.bootstrap(),
            /cannot be both lambda consumer and grpc consumer/);
    });

    await test("rejects being both rpc consumer and grpc consumer", async () =>
    {
        const edaManager = baseManager()
            .actAsGrpcConsumer(new GrpcEventHandler());

        (<any>edaManager)._isRpcConsumer = true;

        await assert.rejects(() => edaManager.bootstrap(),
            /cannot be both rpc consumer and grpc consumer/);
    });

    await test("still rejects the pre-existing subscriber and rpc consumer combination", async () =>
    {
        const edaManager = baseManager()
            .registerEventSubscriptionManager(RedisEventSubMgr, "guard-group");

        (<any>edaManager)._isRpcConsumer = true;

        await assert.rejects(() => edaManager.bootstrap(),
            /cannot be both event subscriber and rpc consumer/);
    });
});
