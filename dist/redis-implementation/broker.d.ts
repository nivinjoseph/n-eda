import { Disposable } from "@nivinjoseph/n-util";
import * as otelApi from "@opentelemetry/api";
import { EdaEvent } from "../eda-event.js";
import { EventRegistration } from "../event-registration.js";
import { Consumer } from "./consumer.js";
import { Processor } from "./processor.js";
import { Topic } from "../topic.js";
import { PartitionIndexes, PartitionMetricsSource, SchedulerMetrics } from "../metrics.js";
export declare class Broker implements Disposable, PartitionMetricsSource {
    private readonly _topic;
    private readonly _consumerGroupId;
    private readonly _consumers;
    private readonly _processors;
    private readonly _scheduler;
    private readonly _metricsTracker;
    private _isDisposed;
    get topic(): Topic;
    get topicName(): string;
    get consumerGroupId(): string;
    get partitionMetrics(): ReadonlyMap<number, PartitionIndexes>;
    get schedulerMetrics(): SchedulerMetrics;
    get trackedKeyCounts(): ReadonlyMap<number, number>;
    constructor(topic: Topic, consumerGroupId: string, consumers: ReadonlyArray<Consumer>, processors: ReadonlyArray<Processor>);
    initialize(): void;
    route(routedEvent: RoutedEvent): Promise<void>;
    /**
     * Called on every consumer poll tick. Deliberately mutates in place rather than
     * allocating, and stores only the raw indexes -- lag and rates are derived at
     * collection time (or by the metrics backend) rather than computed here, because the
     * interval between calls is variable and unknowable from this side.
     */
    report(partition: number, writeIndex: number, readIndex: number, polledAt: number): void;
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
//# sourceMappingURL=broker.d.ts.map