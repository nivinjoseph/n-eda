import assert from "node:assert";
import test, { describe } from "node:test";
import { Logger } from "@nivinjoseph/n-log";
import * as otelApi from "@opentelemetry/api";
import { AggregationTemporality, DataPointType } from "@opentelemetry/sdk-metrics";
import { Redis } from "ioredis";
import { ATTR_ERROR_TYPE } from "@opentelemetry/semantic-conventions";
import {
    ATTR_NEDA_DROP_REASON,
    errorTypeOf,
    instruments,
    PartitionMetricsSource,
    registerPartitionMetricsSource,
    timeRedisCommand,
    unregisterPartitionMetricsSource
} from "../src/metrics.js";
import { Producer } from "../src/redis-implementation/producer.js";
import { findMetric, installTestMeterProvider, requireMetric } from "./utils/metrics-test-utils.js";


interface FakePipeline
{
    setex(...args: Array<unknown>): FakePipeline;
    publish(...args: Array<unknown>): FakePipeline;
    exec(): Promise<Array<[Error | null, unknown]>>;
}

/** Reaches the private method whose discarded result was the data-loss bug. */
interface StoreEventsAccess
{
    _storeEvents(writeIndex: number, eventData: Buffer): Promise<void>;
}


// Deliberately does NOT import eda-test-utils, which constructs a Redis client on import.
// This file must run without docker and without a Redis server.
await describe("metrics module", async () =>
{
    await test("is a safe no-op when no MeterProvider is registered", () =>
    {
        otelApi.metrics.disable();

        assert.doesNotThrow(() =>
        {
            instruments().eventDropped.add(1, { [ATTR_NEDA_DROP_REASON]: "read_failed" });
            instruments().redisCommandDuration.record(0.01, {});
        });
    });

    // The reason src/metrics.ts keys its cache on provider identity rather than memoizing
    // once. metrics.getMeter has no ProxyMeterProvider, so a one-shot memo would bind Noop
    // instruments forever if anything recorded before the host's SDK came up. This test is
    // the executable statement of that constraint -- if it goes red, metrics are silently
    // dead for every consumer whose SDK bootstraps late.
    await test("binds lazily: a provider registered AFTER first use still receives data", async () =>
    {
        otelApi.metrics.disable();

        // Record into the Noop path first.
        instruments().eventDropped.add(3, { [ATTR_NEDA_DROP_REASON]: "read_failed" });

        const testMetrics = installTestMeterProvider();
        try
        {
            instruments().eventDropped.add(7, { [ATTR_NEDA_DROP_REASON]: "read_failed" });

            const collected = await testMetrics.collect();
            const dropped = requireMetric(collected, "n_eda.event.dropped");

            assert.strictEqual(dropped.dataPointType, DataPointType.SUM, "expected a sum");
            assert.strictEqual(dropped.dataPoints.length, 1, "expected exactly one datapoint");
            assert.strictEqual(dropped.dataPoints[0].value, 7,
                "expected only the post-registration measurement; the pre-registration one must not leak in");
        }
        finally
        {
            await testMetrics.shutdown();
        }
    });

    await test("survives shutdown and re-registration", async () =>
    {
        const first = installTestMeterProvider();
        instruments().eventDropped.add(1, { [ATTR_NEDA_DROP_REASON]: "process_failed" });
        await first.shutdown();

        // Back on the Noop path -- must not throw.
        assert.doesNotThrow(() => instruments().eventDropped.add(1, { [ATTR_NEDA_DROP_REASON]: "process_failed" }));

        const second = installTestMeterProvider();
        try
        {
            instruments().eventDropped.add(5, { [ATTR_NEDA_DROP_REASON]: "process_failed" });

            const collected = await second.collect();
            const dropped = requireMetric(collected, "n_eda.event.dropped");

            assert.strictEqual(dropped.dataPoints[0].value, 5, "the re-registered provider must see fresh data");
        }
        finally
        {
            await second.shutdown();
        }
    });

    // The highest-severity regression risk in the whole design. If timeRedisCommand ever
    // swallows a rejection, the consumer loop stops seeing Redis failures and spins on
    // empty results forever.
    await test("timeRedisCommand rethrows and records error.type", async () =>
    {
        const testMetrics = installTestMeterProvider();
        try
        {
            await assert.rejects(
                async () => timeRedisCommand("GET", "consumer", () => Promise.reject(new TypeError("boom"))),
                (error: unknown) => error instanceof TypeError && error.message === "boom",
                "the rejection must propagate unchanged");

            const collected = await testMetrics.collect();
            const duration = requireMetric(collected, "n_eda.redis.command.duration");

            assert.strictEqual(duration.dataPointType, DataPointType.HISTOGRAM, "expected a histogram");
            assert.strictEqual(duration.dataPoints.length, 1, "expected exactly one datapoint");
            assert.strictEqual(duration.dataPoints[0].attributes[ATTR_ERROR_TYPE], "TypeError",
                "the failed attempt must carry error.type -- retries are derived from it");
        }
        finally
        {
            await testMetrics.shutdown();
        }
    });

    await test("timeRedisCommand records success without error.type", async () =>
    {
        const testMetrics = installTestMeterProvider();
        try
        {
            const result = await timeRedisCommand("MGET", "consumer", () => Promise.resolve(42));
            assert.strictEqual(result, 42, "the resolved value must pass through");

            const collected = await testMetrics.collect();
            const duration = requireMetric(collected, "n_eda.redis.command.duration");

            assert.strictEqual(duration.dataPoints.length, 1);
            assert.strictEqual(duration.dataPoints[0].attributes[ATTR_ERROR_TYPE], undefined,
                "a successful command must not carry error.type");
        }
        finally
        {
            await testMetrics.shutdown();
        }
    });

    // Durations are recorded in seconds against second-shaped buckets. Recording
    // milliseconds instead would dump everything into bucket 0 and look broken-but-plausible.
    await test("timeRedisCommand records seconds, not milliseconds", async () =>
    {
        const testMetrics = installTestMeterProvider();
        try
        {
            await timeRedisCommand("GET", "consumer", async () =>
            {
                await new Promise<void>(resolve => setTimeout(resolve, 60));
            });

            const collected = await testMetrics.collect();
            const duration = requireMetric(collected, "n_eda.redis.command.duration");
            const value = <{ sum?: number; count: number; }>duration.dataPoints[0].value;

            assert.ok(value.sum != null && value.sum >= 0.05 && value.sum < 5,
                `a ~60ms command must record ~0.06s, got ${value.sum}`);
        }
        finally
        {
            await testMetrics.shutdown();
        }
    });

    // The registry is a Set, so double registration must not double the series, and
    // unregistering must actually remove them. Exercised here rather than end-to-end because
    // it needs no Redis and pins the semantics precisely.
    await test("partition metrics sources are deduplicated and removable", async () =>
    {
        const source: PartitionMetricsSource = {
            topicName: "some-topic",
            consumerGroupId: "some-group",
            partitionMetrics: new Map([[0, { writeIndex: 10, readIndex: 4, lastPolledAt: Date.now() }]]),
            schedulerMetrics: {
                queueDepth: 3,
                blockedPartitionKeys: 1,
                trackedPartitionKeys: 2,
                availableProcessors: 4
            },
            trackedKeyCounts: new Map([[0, 17]])
        };

        // Delta temporality: cumulative aggregation intentionally keeps reporting async
        // series that were seen before, so a series going away is only visible under delta.
        const testMetrics = installTestMeterProvider(AggregationTemporality.DELTA);
        try
        {
            registerPartitionMetricsSource(source);
            registerPartitionMetricsSource(source);

            const lag = requireMetric(await testMetrics.collect(), "n_eda.partition.lag");
            assert.strictEqual(lag.dataPoints.length, 1, "registering the same source twice must not duplicate series");
            assert.strictEqual(lag.dataPoints[0].value, 6, "lag must be writeIndex - readIndex");
            assert.strictEqual(lag.dataPoints[0].attributes["messaging.destination.partition.id"], "0");
            assert.strictEqual(lag.dataPoints[0].attributes["messaging.consumer.group.name"], "some-group");
            assert.strictEqual(lag.dataPoints[0].attributes["messaging.destination.name"], "some-topic");

            // Scheduler state is observed per topic, not per partition.
            const queueDepth = requireMetric(await testMetrics.collect(), "n_eda.scheduler.queue.depth");
            assert.strictEqual(queueDepth.dataPoints.length, 1);
            assert.strictEqual(queueDepth.dataPoints[0].value, 3);
            assert.strictEqual(queueDepth.dataPoints[0].attributes["messaging.destination.partition.id"], undefined,
                "scheduler metrics must not be attributed per partition");

            // Absolute index values are asserted end-to-end under cumulative temporality; here
            // a delta reader would report the change since the last collection, not the value.
            unregisterPartitionMetricsSource(source);

            const afterUnregister = findMetric(await testMetrics.collect(), "n_eda.partition.lag");
            assert.ok(afterUnregister == null || afterUnregister.dataPoints.length === 0,
                `unregistering must remove the series, got ${afterUnregister?.dataPoints.length}`);
        }
        finally
        {
            unregisterPartitionMetricsSource(source);
            await testMetrics.shutdown();
        }
    });

    // Regression guard for a silent data-loss path: an ioredis pipeline resolves with
    // [Error | null, value] tuples and does NOT reject when an individual command fails, so
    // discarding exec()'s result meant a failed SETEX vanished. The write index had already
    // advanced, so the consumer would burn its 200 read attempts and drop the event for good.
    await test("a failed command inside the producer pipeline surfaces instead of vanishing", async () =>
    {
        const chain: FakePipeline = {
            setex: () => chain,
            publish: () => chain,
            // One failed command and one successful one, which is exactly what ioredis hands
            // back and what the old code threw away.
            exec: () => Promise.resolve([[new Error("SETEX failed"), null], [null, 1]])
        };

        const client = <Redis><unknown>{ pipeline: (): FakePipeline => chain };
        const logger: Logger = {
            logDebug: () => Promise.resolve(),
            logInfo: () => Promise.resolve(),
            logWarning: () => Promise.resolve(),
            logError: () => Promise.resolve()
        };

        const testMetrics = installTestMeterProvider();
        try
        {
            const producer = new Producer("some-topic+++0", client, logger, "some-topic", 60, 0);
            const storeEvents = (<StoreEventsAccess><unknown>producer)._storeEvents.bind(producer);

            await assert.rejects(
                async () => storeEvents(1, Buffer.from("payload")),
                /SETEX failed/,
                "a failed pipeline command must reject so the retry wrapper can act on it");

            const pipelineErrors = requireMetric(await testMetrics.collect(), "n_eda.redis.pipeline.errors");
            assert.strictEqual(pipelineErrors.dataPoints.length, 1);
            assert.strictEqual(pipelineErrors.dataPoints[0].value, 1, "expected exactly one failed command");
            assert.strictEqual(pipelineErrors.dataPoints[0].attributes["db.operation.name"], "SETEX|PUBLISH");
        }
        finally
        {
            await testMetrics.shutdown();
        }
    });

    await test("errorTypeOf uses the class name and never the message", () =>
    {
        class CustomError extends Error { }

        assert.strictEqual(errorTypeOf(new CustomError("secret payload")), "CustomError");
        assert.strictEqual(errorTypeOf(new TypeError("nope")), "TypeError");
        assert.strictEqual(errorTypeOf("just a string"), "_OTHER");
        assert.strictEqual(errorTypeOf(null), "_OTHER");
        assert.strictEqual(errorTypeOf({ message: "not an error" }), "_OTHER");
    });
});
