import { given } from "@nivinjoseph/n-defensive";
import { ObjectDisposedException } from "@nivinjoseph/n-exception";
import { Disposable } from "@nivinjoseph/n-util";
import * as otelApi from "@opentelemetry/api";
import { EdaEvent } from "../eda-event.js";
import { EventRegistration } from "../event-registration.js";
import { Consumer } from "./consumer.js";
// import { DefaultScheduler } from "./default-scheduler.js";
import { OptimizedScheduler } from "./optimized-scheduler.js";
import { Processor } from "./processor.js";
import { Scheduler } from "./scheduler.js";
import { Topic } from "../topic.js";
import {
    PartitionIndexes,
    PartitionMetricsSource,
    registerPartitionMetricsSource,
    SchedulerMetrics,
    unregisterPartitionMetricsSource
} from "../metrics.js";


export class Broker implements Disposable, PartitionMetricsSource
{
    private readonly _topic: Topic;
    private readonly _consumerGroupId: string;
    private readonly _consumers: ReadonlyArray<Consumer>;
    private readonly _processors: ReadonlyArray<Processor>;
    private readonly _scheduler: Scheduler;
    private readonly _metricsTracker = new Map<number, PartitionIndexes>;
    private _isDisposed = false;


    public get topic(): Topic { return this._topic; }
    public get topicName(): string { return this._topic.name; }
    public get consumerGroupId(): string { return this._consumerGroupId; }
    public get partitionMetrics(): ReadonlyMap<number, PartitionIndexes> { return this._metricsTracker; }
    public get schedulerMetrics(): SchedulerMetrics { return this._scheduler.metrics; }

    public get trackedKeyCounts(): ReadonlyMap<number, number>
    {
        const counts = new Map<number, number>();
        this._consumers.forEach(t => counts.set(t.partition, t.trackedKeyCount));

        return counts;
    }


    public constructor(topic: Topic, consumerGroupId: string, consumers: ReadonlyArray<Consumer>,
        processors: ReadonlyArray<Processor>)
    {
        given(topic, "topic").ensureHasValue().ensureIsType(Topic);
        this._topic = topic;

        given(consumerGroupId, "consumerGroupId").ensureHasValue().ensureIsString();
        this._consumerGroupId = consumerGroupId;

        given(consumers, "consumers").ensureHasValue().ensureIsArray().ensure(t => t.isNotEmpty);
        this._consumers = consumers;

        given(processors, "processors").ensureHasValue().ensureIsArray().ensure(t => t.isNotEmpty)
            .ensure(t => t.length === consumers.length, "length has to match consumers length");
        this._processors = processors;

        this._scheduler = new OptimizedScheduler(processors);
    }


    public initialize(): void
    {
        registerPartitionMetricsSource(this);

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
     * Called on every consumer poll tick. Deliberately mutates in place rather than
     * allocating, and stores only the raw indexes -- lag and rates are derived at
     * collection time (or by the metrics backend) rather than computed here, because the
     * interval between calls is variable and unknowable from this side.
     */
    public report(partition: number, writeIndex: number, readIndex: number, polledAt: number): void
    {
        const existing = this._metricsTracker.get(partition);

        if (existing != null)
        {
            existing.writeIndex = writeIndex;
            existing.readIndex = readIndex;
            existing.lastPolledAt = polledAt;
        }
        else
            this._metricsTracker.set(partition, { writeIndex, readIndex, lastPolledAt: polledAt });
    }

    public async dispose(): Promise<void>
    {
        // Must happen before anything that can throw. The catch below would otherwise
        // swallow the failure and leave this broker in the registry forever, reporting
        // frozen stale lag.
        unregisterPartitionMetricsSource(this);

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