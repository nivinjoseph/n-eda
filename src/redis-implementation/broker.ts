import { given } from "@nivinjoseph/n-defensive";
import { ObjectDisposedException } from "@nivinjoseph/n-exception";
import { Disposable } from "@nivinjoseph/n-util";
import { EdaEvent } from "../eda-event";
import { EventRegistration } from "../event-registration";
import { Consumer } from "./consumer";
// import { DefaultScheduler } from "./default-scheduler";
import { OptimizedScheduler } from "./optimized-scheduler";
import { Processor } from "./processor";
import { Scheduler } from "./scheduler";
import * as otelApi from "@opentelemetry/api";


export class Broker implements Disposable
{
    private readonly _consumers: ReadonlyArray<Consumer>;
    private readonly _processors: ReadonlyArray<Processor>;
    private readonly _scheduler: Scheduler;
    
    private _isDisposed = false;
    
    
    public constructor(consumers: ReadonlyArray<Consumer>, processors: ReadonlyArray<Processor>)
    {
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