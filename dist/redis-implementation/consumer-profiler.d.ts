export declare class ConsumerProfiler {
    private readonly _eventTraces;
    private readonly _eventProcessings;
    private readonly _eventRetries;
    private readonly _eventFailures;
    private _fetchPartitionWriteIndexProfiler;
    private _fetchConsumerPartitionReadIndexProfiler;
    private _incrementConsumerPartitionReadIndexProfiler;
    private _retrieveEventProfiler;
    private _batchRetrieveEventsProfiler;
    private _decompressEventProfiler;
    private _deserializeEventProfiler;
    private _eventProfiler;
    private static readonly _eventQueuePressure;
    private static _startTime;
    private static _eventQueuePressureInterval;
    static initialize(): void;
    private static trackEventQueuePressure;
    fetchPartitionWriteIndexStarted(): void;
    fetchPartitionWriteIndexEnded(): void;
    fetchConsumerPartitionReadIndexStarted(): void;
    fetchConsumerPartitionReadIndexEnded(): void;
    incrementConsumerPartitionReadIndexStarted(): void;
    incrementConsumerPartitionReadIndexEnded(): void;
    retrieveEventStarted(): void;
    retrieveEventEnded(): void;
    batchRetrieveEventsStarted(): void;
    batchRetrieveEventsEnded(): void;
    decompressEventStarted(): void;
    decompressEventEnded(): void;
    deserializeEventStarted(): void;
    deserializeEventEnded(): void;
    eventProcessingStarted(eventName: string, eventId: string): void;
    eventProcessingEnded(eventName: string, eventId: string): void;
    eventRetried(eventName: string): void;
    eventFailed(eventName: string): void;
    static aggregate(consumerName: string, consumerProfilers: ReadonlyArray<ConsumerProfiler>): void;
}
