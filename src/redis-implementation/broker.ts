import { given } from "@nivinjoseph/n-defensive";
import { ObjectDisposedException } from "@nivinjoseph/n-exception";
import { Disposable, Duration } from "@nivinjoseph/n-util";
import * as otelApi from "@opentelemetry/api";
import { EdaEvent } from "../eda-event.js";
import { EventRegistration } from "../event-registration.js";
import { Consumer } from "./consumer.js";
// import { DefaultScheduler } from "./default-scheduler.js";
import { OptimizedScheduler } from "./optimized-scheduler.js";
import { Processor } from "./processor.js";
import { Scheduler } from "./scheduler.js";
import { Topic, TopicPartitionMetrics } from "../topic.js";


const oneMinuteMs = Duration.fromMinutes(1).toMilliSeconds();


/**
 * Fans a topic's consumers out onto its processors: owns one `Consumer` and one `Processor` per partition
 * this process is responsible for, plus the scheduler that enforces per-partition-key ordering.
 *
 * Contract: created by `RedisEventSubMgr.consume()`, one per subscribed topic. `initialize()` wires each
 * consumer to this broker; `route()` hands a read event to the scheduler and resolves once the handler has
 * succeeded or exhausted its retries.
 *
 * Note: always constructs an `OptimizedScheduler`; `DefaultScheduler` is deprecated baseline-only code.
 */
export class Broker implements Disposable
{
    private readonly _topic: Topic;
    private readonly _consumers: ReadonlyArray<Consumer>;
    private readonly _processors: ReadonlyArray<Processor>;
    private readonly _scheduler: Scheduler;
    private readonly _metricsTracker = new Map<number, TopicPartitionMetrics>;
    private _isDisposed = false;
    
    
    public get topic(): Topic { return this._topic; }
    public get metrics(): ReadonlyMap<number, TopicPartitionMetrics> { return this._metricsTracker; }


    public constructor(topic: Topic, consumers: ReadonlyArray<Consumer>, processors: ReadonlyArray<Processor>)
    {
        given(topic, "topic").ensureHasValue().ensureIsType(Topic);
        this._topic = topic;
        
        given(consumers, "consumers").ensureHasValue().ensureIsArray().ensure(t => t.isNotEmpty);
        this._consumers = consumers;

        given(processors, "processors").ensureHasValue().ensureIsArray().ensure(t => t.isNotEmpty)
            .ensure(t => t.length === consumers.length, "length has to match consumers length");
        this._processors = processors;

        this._scheduler = new OptimizedScheduler(processors);
    }


    public initialize(): void
    {
        this._consumers.forEach(t => t.registerBroker(this));
        this._consumers.forEach(t => t.consume());
    }

    public route(routedEvent: RoutedEvent): Promise<void>
    {
        if (this._isDisposed)
            return Promise.reject(new ObjectDisposedException("Broker"));

        return this._scheduler.scheduleWork(routedEvent);
    }
    
    /**
     * Records a partition's current indexes and derives its throughput rates from the previous report.
     *
     * RULE: the rates are normalized to batches per minute rather than raw deltas, because the
     * `MetricsReporter` logs on a timer independent of this call and will re-log an entry that no consumer
     * has refreshed since the previous tick. A per-minute rate survives that re-logging unchanged; a raw
     * delta would read as a second, phantom batch of the same events.
     *
     * @param partition - the partition being reported on
     * @param writeIndex - the producer's current slot counter
     * @param readIndex - this consumer group's current offset
     * @param now - epoch milliseconds the indexes were sampled at; the consumer's own loop clock
     */
    public report(partition: number, writeIndex: number, readIndex: number, now: number): void
    {
        // Clamped: after a Redis flush the write index restarts below the read index, and a negative backlog
        // would corrupt the dashboards these figures feed. A regressed index also means no readable backlog.
        const lag = Math.max(0, writeIndex - readIndex);

        const last = this._metricsTracker.get(partition);

        // Rates need a usable baseline: a first report has none, a non-advancing clock would divide by zero,
        // and a regressed index (flush, eviction, environment reset) would yield a huge negative rate. All
        // three reset to 0 rather than reporting a fabricated figure.
        const elapsedMs = last == null ? 0 : now - last.sampledAt;
        const hasBaseline = last != null && elapsedMs > 0
            && writeIndex >= last.writeIndex && readIndex >= last.readIndex;

        // Two decimals rather than whole batches: a topic doing 20 events an hour is 0.33/min, which would
        // round to 0 and read as a dead partition on the dashboard.
        const perMinute = (delta: number): number => Math.round(delta / elapsedMs * oneMinuteMs * 100) / 100;

        this._metricsTracker.set(partition, {
            lag, writeIndex, readIndex,
            productionRate: hasBaseline ? perMinute(writeIndex - last.writeIndex) : 0,
            consumptionRate: hasBaseline ? perMinute(readIndex - last.readIndex) : 0,
            sampledAt: now
        });
    }

    public async dispose(): Promise<void>
    {
        // console.warn("Disposing broker");
        this._isDisposed = true;
        await Promise.all([
            ...this._consumers.map(t => t.dispose()),
            ...this._processors.map(t => t.dispose()),
            this._scheduler.dispose()
        ])
            .then(() =>
            {
                // console.warn("Broker disposed");
            })
            .catch(e => console.error(e));
    }
}


/**
 * One event as it travels from a `Consumer` to a `Processor`: the deserialized event plus everything needed
 * to locate, trace, and acknowledge it.
 *
 * Note: internal transport type.
 */
export interface RoutedEvent
{
    consumerId: string;
    topic: string;
    partition: number;
    eventName: string;
    eventRegistration: EventRegistration;
    eventIndex: number;
    eventKey: string;
    eventId: string;
    rawEvent: object;
    event: EdaEvent;
    partitionKey: string;
    span: otelApi.Span;
}