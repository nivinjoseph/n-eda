import { Disposable } from "@nivinjoseph/n-util";
import * as otelApi from "@opentelemetry/api";
import { EdaEvent } from "../eda-event.js";
import { EventRegistration } from "../event-registration.js";
import { Consumer } from "./consumer.js";
import { Processor } from "./processor.js";
import { Topic, TopicPartitionMetrics } from "../topic.js";
export declare class Broker implements Disposable {
    private readonly _topic;
    private readonly _consumers;
    private readonly _processors;
    private readonly _scheduler;
    private readonly _metricsTracker;
    private _isDisposed;
    get topic(): Topic;
    get metrics(): ReadonlyMap<number, TopicPartitionMetrics>;
    constructor(topic: Topic, consumers: ReadonlyArray<Consumer>, processors: ReadonlyArray<Processor>);
    initialize(): void;
    route(routedEvent: RoutedEvent): Promise<void>;
    report(partition: number, writeIndex: number, readIndex: number): void;
    dispose(): Promise<void>;
}
export interface RoutedEvent {
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
