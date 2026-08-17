import { given } from "@nivinjoseph/n-defensive";
import { ObjectDisposedException } from "@nivinjoseph/n-exception";
import { ComponentInstaller, inject, Registry } from "@nivinjoseph/n-ject";
import { ConsoleLogger, LogDateTimeZone } from "@nivinjoseph/n-log";
import { Delay, Disposable, DisposableWrapper, Duration, Serializable, serialize } from "@nivinjoseph/n-util";
import { AggregationTemporality, DataPointType } from "@opentelemetry/sdk-metrics";
import { Redis } from "ioredis";
import assert from "node:assert";
import test, { after, before, describe } from "node:test";
import {
    EdaEvent,
    EdaEventHandler,
    EdaManager,
    event,
    EventBus,
    RedisEventBus,
    RedisEventSubMgr,
    Topic
} from "../src/index.js";
import { instruments } from "../src/metrics.js";
import {
    dataPointsWhere,
    findMetric,
    FORBIDDEN_METRIC_ATTRIBUTES,
    installTestMeterProvider,
    requireMetric,
    TestMetrics
} from "./utils/metrics-test-utils.js";


// Deliberately self-contained rather than reusing eda-test-utils: node --test runs files
// concurrently, and sharing the "basic"/"analytic" topics and the "main" consumer group with
// eda.test.ts would have the two suites stealing each other's events.
const PRIMARY_TOPIC = "metrics-primary";
const SECONDARY_TOPIC = "metrics-secondary";
const CONSUMER_GROUP = "metrics";
const NUM_PARTITIONS = 25;
const NUM_PARTITION_KEYS = 20;
const EVENTS_PER_PARTITION_KEY = 25;

const NUM_PRIMARY_EVENTS = NUM_PARTITION_KEYS * EVENTS_PER_PARTITION_KEY;
// Every primary event's handler publishes exactly one secondary event.
const NUM_SECONDARY_EVENTS = NUM_PRIMARY_EVENTS;
const NUM_PROCESSED_EVENTS = NUM_PRIMARY_EVENTS + NUM_SECONDARY_EVENTS;


class MetricsEventHistory implements Disposable
{
    private readonly _records = new Array<string>();
    private _isDisposed = false;

    public get records(): ReadonlyArray<string> { return this._records; }


    public async recordEvent(event: EdaEvent): Promise<void>
    {
        given(event, "event").ensureHasValue().ensureIsObject();

        if (this._isDisposed)
            throw new ObjectDisposedException("MetricsEventHistory");

        // Gives handlerDuration something above the noise floor to measure, which is what
        // catches a seconds-vs-milliseconds unit bug.
        await Delay.milliseconds(10);

        this._records.push(event.id);
    }

    public dispose(): Promise<void>
    {
        this._isDisposed = true;
        return Promise.resolve();
    }
}


@serialize("MetricsTest")
class PrimaryEvent extends Serializable implements EdaEvent
{
    private readonly _id: string;

    @serialize
    public get id(): string { return this._id; }

    @serialize
    public get name(): string { return (<Object>PrimaryEvent).getTypeName(); }

    public get partitionKey(): string { return this.id.split("-")[0]; }

    public get refId(): string { return "neda"; }
    public get refType(): string { return "neda"; }


    public constructor(data: { id: string; })
    {
        super(data);

        const { id } = data;

        given(id, "id").ensureHasValue().ensureIsString();
        this._id = id;
    }
}

@serialize("MetricsTest")
class SecondaryEvent extends Serializable implements EdaEvent
{
    private readonly _id: string;

    @serialize
    public get id(): string { return this._id; }

    @serialize
    public get name(): string { return (<Object>SecondaryEvent).getTypeName(); }

    public get partitionKey(): string { return this.id.split("-")[0]; }

    public get refId(): string { return "neda"; }
    public get refType(): string { return "neda"; }


    public constructor(data: { id: string; })
    {
        super(data);

        const { id } = data;

        given(id, "id").ensureHasValue().ensureIsString();
        this._id = id;
    }
}


@event(PrimaryEvent)
@inject("MetricsEventHistory", "EventBus")
class PrimaryEventHandler implements EdaEventHandler<PrimaryEvent>
{
    private readonly _history: MetricsEventHistory;
    private readonly _eventBus: EventBus;


    public constructor(history: MetricsEventHistory, eventBus: EventBus)
    {
        given(history, "history").ensureHasValue().ensureIsObject();
        this._history = history;

        given(eventBus, "eventBus").ensureHasValue().ensureIsObject();
        this._eventBus = eventBus;
    }


    public async handle(event: PrimaryEvent): Promise<void>
    {
        given(event, "event").ensureHasValue().ensureIsObject().ensureIsType(PrimaryEvent);

        await this._history.recordEvent(event);

        await this._eventBus.publish(SECONDARY_TOPIC, new SecondaryEvent({ id: `${event.partitionKey}-secondary_${event.id}` }));
    }
}

@event(SecondaryEvent)
@inject("MetricsEventHistory")
class SecondaryEventHandler implements EdaEventHandler<SecondaryEvent>
{
    private readonly _history: MetricsEventHistory;


    public constructor(history: MetricsEventHistory)
    {
        given(history, "history").ensureHasValue().ensureIsObject();
        this._history = history;
    }


    public async handle(event: SecondaryEvent): Promise<void>
    {
        given(event, "event").ensureHasValue().ensureIsObject().ensureIsType(SecondaryEvent);

        await this._history.recordEvent(event);
    }
}


class MetricsComponentInstaller implements ComponentInstaller
{
    public async install(registry: Registry): Promise<void>
    {
        given(registry, "registry").ensureHasValue().ensureIsObject();

        const edaRedisClient = new Redis();
        const edaRedisClientDisposable = new DisposableWrapper(async () =>
        {
            await Delay.seconds(2);
            await new Promise<void>((resolve, _) =>
            {
                edaRedisClient.quit(() => resolve()).catch(e => console.error(e));
            });
        });

        registry
            .registerInstance("Logger", new ConsoleLogger({ logDateTimeZone: LogDateTimeZone.est }))
            .registerInstance("EdaRedisClient", edaRedisClient)
            .registerInstance("EdaRedisClientDisposable", edaRedisClientDisposable)
            .registerSingleton("MetricsEventHistory", MetricsEventHistory);
    }
}

async function createMetricsEdaManager(): Promise<EdaManager>
{
    const primaryTopic = new Topic(PRIMARY_TOPIC, Duration.fromHours(1), NUM_PARTITIONS).subscribe();
    const secondaryTopic = new Topic(SECONDARY_TOPIC, Duration.fromHours(1), NUM_PARTITIONS).subscribe();

    const edaManager = new EdaManager();
    edaManager
        .useInstaller(new MetricsComponentInstaller())
        .registerEventSubscriptionManager(RedisEventSubMgr, CONSUMER_GROUP)
        .cleanUpKeys()
        .useConsumerName("metrics-test")
        .registerTopics(primaryTopic, secondaryTopic)
        .registerEventHandlers(PrimaryEventHandler, SecondaryEventHandler)
        .registerEventBus(RedisEventBus);

    await edaManager.bootstrap();

    return edaManager;
}


await describe("eda metrics", async () =>
{
    let edaManager: EdaManager;
    let testMetrics: TestMetrics;

    before(async () =>
    {
        // Registered before bootstrap, which is what a real host does. The lazy-binding case
        // is covered separately in metrics-unit.test.ts.
        testMetrics = installTestMeterProvider();
        edaManager = await createMetricsEdaManager();
    });

    after(async () =>
    {
        await edaManager.dispose();
        await testMetrics.shutdown();
    });

    await test("emits metrics across the publish/consume/process lifecycle", async () =>
    {
        // @ts-expect-error: not used
        const consumePromise = edaManager.beginConsumption();
        const eventBus = edaManager.serviceLocator.resolve<EventBus>("EventBus");
        const history = edaManager.serviceLocator.resolve<MetricsEventHistory>("MetricsEventHistory");

        const primaryEvents = new Array<EdaEvent>();
        for (let k = 0; k < NUM_PARTITION_KEYS; k++)
        {
            for (let j = 0; j < EVENTS_PER_PARTITION_KEY; j++)
                primaryEvents.push(new PrimaryEvent({ id: `pk_${k}-evt_${j}` }));
        }

        await eventBus.publish(PRIMARY_TOPIC, ...primaryEvents);

        // Drain, then give every partition's consumer loop at least one more tick so the
        // read index it reports has caught up to the write index.
        for (let i = 0; i < 60 && history.records.length < NUM_PROCESSED_EVENTS; i++)
            await Delay.seconds(1);

        assert.strictEqual(history.records.length, NUM_PROCESSED_EVENTS,
            "events did not drain; the metric assertions below would be meaningless");

        await Delay.seconds(7);

        const collected = await testMetrics.collect();

        // ---- publish ----------------------------------------------------------------

        const sent = requireMetric(collected, "messaging.client.sent.messages");
        assert.strictEqual(sent.dataPointType, DataPointType.SUM);
        assert.strictEqual(sent.isMonotonic, true, "sent messages must be monotonic");

        const sentPrimary = dataPointsWhere(sent, { "messaging.destination.name": PRIMARY_TOPIC });
        assert.strictEqual(sentPrimary.length, 1, "expected one series for the primary topic");
        assert.strictEqual(sentPrimary[0].value, NUM_PRIMARY_EVENTS);
        assert.strictEqual(sentPrimary[0].attributes["n_eda.event.name"], "PrimaryEvent");

        const sentSecondary = dataPointsWhere(sent, { "messaging.destination.name": SECONDARY_TOPIC });
        assert.strictEqual(sentSecondary.length, 1, "expected one series for the secondary topic");
        assert.strictEqual(sentSecondary[0].value, NUM_SECONDARY_EVENTS);

        // ---- consume ----------------------------------------------------------------

        const consumed = requireMetric(collected, "messaging.client.consumed.messages");
        const consumedPrimary = dataPointsWhere(consumed, { "messaging.destination.name": PRIMARY_TOPIC });
        const consumedSecondary = dataPointsWhere(consumed, { "messaging.destination.name": SECONDARY_TOPIC });

        assert.strictEqual(consumedPrimary.reduce((acc, t) => acc + <number>t.value, 0), NUM_PRIMARY_EVENTS);
        assert.strictEqual(consumedSecondary.reduce((acc, t) => acc + <number>t.value, 0), NUM_SECONDARY_EVENTS);
        assert.strictEqual(consumedPrimary[0].attributes["messaging.consumer.group.name"], CONSUMER_GROUP);

        // ---- process ----------------------------------------------------------------

        const processDuration = requireMetric(collected, "messaging.process.duration");
        assert.strictEqual(processDuration.dataPointType, DataPointType.HISTOGRAM);

        const processCount = processDuration.dataPoints
            .reduce((acc, t) => acc + (<{ count: number; }><unknown>t.value).count, 0);
        assert.strictEqual(processCount, NUM_PROCESSED_EVENTS, "every processed event must be timed");

        const handlerDuration = requireMetric(collected, "n_eda.event.handler.duration");
        const handlerValues = handlerDuration.dataPoints
            .map(t => <{ count: number; min?: number; sum?: number; }><unknown>t.value);

        assert.strictEqual(handlerValues.reduce((acc, t) => acc + t.count, 0), NUM_PROCESSED_EVENTS);

        // Each handler awaits a 10ms delay, so a min below that means durations were recorded
        // in milliseconds against second-shaped buckets -- the classic silent unit bug.
        const handlerMin = Math.min(...handlerValues.map(t => t.min ?? Number.POSITIVE_INFINITY));
        assert.ok(handlerMin >= 0.009, `handler duration must be in seconds; min was ${handlerMin}`);
        assert.ok(handlerMin < 60, `handler duration looks like milliseconds; min was ${handlerMin}`);

        const attempts = requireMetric(collected, "n_eda.event.process.attempts");
        const successAttempts = dataPointsWhere(attempts, { "n_eda.outcome": "success" });
        assert.strictEqual(successAttempts.reduce((acc, t) => acc + <number>t.value, 0), NUM_PROCESSED_EVENTS,
            "a clean run must record exactly one successful attempt per event");

        // ---- partition observables ---------------------------------------------------

        const lag = requireMetric(collected, "n_eda.partition.lag");
        assert.strictEqual(lag.dataPointType, DataPointType.GAUGE);
        assert.ok(lag.dataPoints.length > 0, "expected partition lag to be observed");
        assert.ok(lag.dataPoints.length <= 2 * NUM_PARTITIONS,
            `expected at most ${2 * NUM_PARTITIONS} lag series, got ${lag.dataPoints.length}`);

        for (const dataPoint of lag.dataPoints)
        {
            assert.strictEqual(dataPoint.value, 0, "after a full drain every partition must have zero lag");
            assert.ok(dataPoint.attributes["messaging.destination.partition.id"] != null,
                "lag must be attributed per partition");
            assert.strictEqual(dataPoint.attributes["messaging.consumer.group.name"], CONSUMER_GROUP,
                "lag must carry the consumer group -- the write index key is shared across groups");
        }

        const writeIndex = requireMetric(collected, "n_eda.partition.write_index");
        const readIndex = requireMetric(collected, "n_eda.partition.read_index");
        assert.strictEqual(writeIndex.dataPointType, DataPointType.SUM);
        assert.strictEqual(writeIndex.isMonotonic, true,
            "the write index must be monotonic so the backend can rate() it");

        const totalWrite = writeIndex.dataPoints.reduce((acc, t) => acc + t.value, 0);
        const totalRead = readIndex.dataPoints.reduce((acc, t) => acc + <number>t.value, 0);
        assert.strictEqual(totalWrite, totalRead, "after a full drain the read index must have caught up");

        // The indexes count BATCHES, not events: one publish call per partition is a single
        // INCR regardless of how many events it carries. 500 primary events published in one
        // call fan out to at most 25 batches, while the 500 secondary events are published one
        // at a time. This is why lag understates the event backlog.
        assert.ok(totalWrite < NUM_PROCESSED_EVENTS,
            `indexes should count batches, not events: got ${totalWrite} for ${NUM_PROCESSED_EVENTS} events`);

        const pollAge = requireMetric(collected, "n_eda.consumer.poll.age");
        for (const dataPoint of pollAge.dataPoints)
        {
            assert.ok(<number>dataPoint.value >= 0 && <number>dataPoint.value < 120,
                `poll age should be seconds since the last tick, got ${dataPoint.value}`);
        }

        // ---- batch / read behaviour --------------------------------------------------

        const batchSize = requireMetric(collected, "n_eda.consumer.batch.size");
        assert.ok(batchSize.dataPoints.length > 0, "expected batch sizes to be recorded");

        const readAttempts = requireMetric(collected, "n_eda.consumer.read.attempts");
        assert.ok(readAttempts.dataPoints.length > 0, "expected read attempts to be recorded");

        // ---- Redis commands ----------------------------------------------------------

        const redisDuration = requireMetric(collected, "n_eda.redis.command.duration");
        const observedOperations = new Set(redisDuration.dataPoints.map(t => t.attributes["db.operation.name"]));
        for (const expected of ["INCR", "MGET", "SET", "MGETBUFFER", "SETEX|PUBLISH"])
            assert.ok(observedOperations.has(expected), `expected Redis timings for ${expected}`);

        assert.ok(redisDuration.dataPoints.every(t => t.attributes["messaging.destination.name"] === undefined),
            "Redis timings are a property of the connection and must not be attributed per topic");

        // ---- scheduler ---------------------------------------------------------------

        const schedulerWait = requireMetric(collected, "n_eda.scheduler.wait.duration");
        assert.ok(schedulerWait.dataPoints.length > 0, "expected scheduler waits to be recorded");

        const queueDepth = requireMetric(collected, "n_eda.scheduler.queue.depth");
        for (const dataPoint of queueDepth.dataPoints)
            assert.strictEqual(dataPoint.value, 0, "the scheduler should be drained");

        requireMetric(collected, "n_eda.scheduler.processors.available");
        requireMetric(collected, "n_eda.scheduler.partitions.blocked");

        // ---- payload, compression, batching ------------------------------------------

        const payloadSize = requireMetric(collected, "n_eda.event.payload.size");
        const publishPayloads = dataPointsWhere(payloadSize, { "n_eda.direction": "publish" });
        const consumePayloads = dataPointsWhere(payloadSize, { "n_eda.direction": "consume" });
        assert.ok(publishPayloads.length > 0 && consumePayloads.length > 0,
            "expected payload sizes for both directions");

        requireMetric(collected, "n_eda.event.compression.duration");

        const batchCount = requireMetric(collected, "n_eda.event.batch.message_count");
        const primaryBatches = dataPointsWhere(batchCount, { "messaging.destination.name": PRIMARY_TOPIC });
        const primaryBatchValue = <{ count: number; max?: number; }>primaryBatches[0].value;
        assert.ok(primaryBatchValue.max != null && primaryBatchValue.max > 1,
            "the single primary publish call batches many events into one Redis key");

        const trackedKeys = requireMetric(collected, "n_eda.tracked_keys.size");
        assert.ok(trackedKeys.dataPoints.length > 0, "expected tracked key counts per partition");

        // ---- nothing should have been lost -------------------------------------------

        const dropped = findMetric(collected, "n_eda.event.dropped");
        if (dropped != null)
        {
            const totalDropped = dropped.dataPoints.reduce((acc, t) => acc + <number>t.value, 0);
            assert.strictEqual(totalDropped, 0, "a clean run must not drop events");
        }

        const loopErrors = findMetric(collected, "n_eda.consumer.loop.errors");
        if (loopErrors != null)
        {
            const totalLoopErrors = loopErrors.dataPoints.reduce((acc, t) => acc + <number>t.value, 0);
            assert.strictEqual(totalLoopErrors, 0, "a clean run must not hit the consumer catch-all");
        }

        const skipped = findMetric(collected, "n_eda.event.skipped");
        if (skipped != null)
        {
            const validReasons = ["duplicate", "no_registration", "tracked_keys_cleared"];
            for (const dataPoint of skipped.dataPoints)
            {
                assert.ok(validReasons.contains(<string>dataPoint.attributes["n_eda.skip.reason"]),
                    `unexpected skip reason ${dataPoint.attributes["n_eda.skip.reason"]}`);
            }
        }

        // ---- cardinality guard --------------------------------------------------------

        // Stops a future contributor from pasting the span attribute blocks (which correctly
        // carry the message id and partition key) into a metric call.
        for (const metric of collected)
        {
            for (const dataPoint of metric.dataPoints)
            {
                for (const forbidden of FORBIDDEN_METRIC_ATTRIBUTES)
                {
                    assert.ok(!(forbidden in dataPoint.attributes),
                        `${metric.descriptor.name} carries the unbounded attribute '${forbidden}'`);
                }
            }

            assert.ok(metric.dataPoints.length <= 250,
                `${metric.descriptor.name} has ${metric.dataPoints.length} series, which suggests a cardinality regression`);
        }
    });

    // Guards the unregister ordering in Broker.dispose(). If the source is left in the
    // registry, a disposed broker reports frozen stale lag forever and leaks.
    await test("unregisters its partition metrics sources on dispose", async () =>
    {
        // Delta temporality: cumulative aggregation intentionally keeps reporting async series
        // that were seen before, so a series going away is only visible under delta.
        const deltaMetrics = installTestMeterProvider(AggregationTemporality.DELTA);
        try
        {
            // Swapping the provider rebuilds the instruments, so the batch observable callback
            // has to be re-registered against the new meter before anything can be collected.
            instruments();

            const before = await deltaMetrics.collect();
            assert.ok(requireMetric(before, "n_eda.partition.lag").dataPoints.length > 0,
                "expected lag series before dispose");

            await edaManager.dispose();

            const afterDispose = await deltaMetrics.collect();
            const lag = findMetric(afterDispose, "n_eda.partition.lag");

            assert.ok(lag == null || lag.dataPoints.length === 0,
                `expected no lag series after dispose, got ${lag?.dataPoints.length}`);
        }
        finally
        {
            await deltaMetrics.shutdown();
        }
    });
});
