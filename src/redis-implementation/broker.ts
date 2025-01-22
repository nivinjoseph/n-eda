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
import { Topic, TopicPartitionMetrics } from "../topic.js";


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
    
    public report(partition: number, writeIndex: number, readIndex: number): void
    {
        const lag = writeIndex - readIndex;
        
        const last = this._metricsTracker.get(partition);
        let lastWriteIndex = writeIndex;
        let lastReadIndex = readIndex;
        if (last != null)
        {
            lastWriteIndex = last.writeIndex;
            lastReadIndex = last.readIndex;
        }
        
        this._metricsTracker.set(partition, {
            lag, writeIndex, readIndex,
            productionRate: writeIndex - lastWriteIndex,
            consumptionRate: readIndex - lastReadIndex
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