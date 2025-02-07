import { Duration } from "@nivinjoseph/n-util";
export declare class Topic {
    private readonly _name;
    private readonly _ttlMinutes;
    private readonly _numPartitions;
    private _isForce;
    private _isFlush;
    private _publishOnly;
    private _partitionAffinity;
    private _isDisabled;
    get name(): string;
    get ttlMinutes(): number;
    get numPartitions(): number;
    get publishOnly(): boolean;
    get partitionAffinity(): ReadonlyArray<number> | null;
    get isDisabled(): boolean;
    get isForce(): boolean;
    get isFlush(): boolean;
    constructor(name: string, ttlDuration: Duration, numPartitions: number);
    subscribe(): Topic;
    forcePublish(): Topic;
    flushConsume(): Topic;
    /**
     * @param partitionAffinity  this should be in the format `${lowerLimitPartitionNumber}-${upperLimitPartitionNumber}`
     * These Partition numbers are INCLUSIVE and should be in the range [0, the number of partitions configured - 1]
     */
    configurePartitionAffinity(partitionAffinity: `${number}-${number}`): Topic;
    disable(): Topic;
}
export interface TopicPartitionMetrics {
    lag: number;
    writeIndex: number;
    readIndex: number;
    productionRate: number;
    consumptionRate: number;
}
