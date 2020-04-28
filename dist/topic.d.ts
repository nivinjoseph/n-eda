export declare class Topic {
    private readonly _name;
    private readonly _numPartitions;
    private readonly _partitionAffinity;
    get name(): string;
    get numPartitions(): number;
    get partitionAffinity(): ReadonlyArray<number> | null;
    get hasPartitionAffinity(): boolean;
    constructor(name: string, numPartitions?: number, partitionAffinity?: ReadonlyArray<number>);
}
