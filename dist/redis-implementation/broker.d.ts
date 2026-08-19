import { Disposable } from "@nivinjoseph/n-util";
import * as otelApi from "@opentelemetry/api";
import { EdaEvent } from "../eda-event.js";
import { EventRegistration } from "../event-registration.js";
import { Consumer } from "./consumer.js";
import { Processor } from "./processor.js";
import { Topic, TopicPartitionMetrics } from "../topic.js";
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
    report(partition: number, writeIndex: number, readIndex: number, now: number): void;
    dispose(): Promise<void>;
}
/**
 * One event as it travels from a `Consumer` to a `Processor`: the deserialized event plus everything needed
 * to locate, trace, and acknowledge it.
 *
 * Note: internal transport type.
 */
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