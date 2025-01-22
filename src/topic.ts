import { given } from "@nivinjoseph/n-defensive";
import { ArgumentException } from "@nivinjoseph/n-exception";
import { Duration, TypeHelper } from "@nivinjoseph/n-util";

// public
export class Topic
{
    private readonly _name: string;
    private readonly _ttlMinutes: number;
    private readonly _numPartitions: number;
    private readonly _flush: boolean;

    private _publishOnly = true;
    private _partitionAffinity: ReadonlyArray<number> | null = null;
    private _isDisabled = false;


    public get name(): string { return this._name; }
    public get ttlMinutes(): number { return this._ttlMinutes; }
    public get numPartitions(): number { return this._numPartitions; }
    public get publishOnly(): boolean { return this._publishOnly; }
    public get partitionAffinity(): ReadonlyArray<number> | null { return this._partitionAffinity; }
    public get isDisabled(): boolean { return this._isDisabled; }
    public get flush(): boolean { return this._flush; }


    public constructor(name: string, ttlDuration: Duration, numPartitions: number, flush = false)
    {
        given(name, "name").ensureHasValue().ensureIsString();
        this._name = name.trim();

        given(ttlDuration, "ttlDuration").ensureHasValue();
        this._ttlMinutes = ttlDuration.toMinutes(true);

        given(numPartitions, "numPartitions").ensureHasValue().ensureIsNumber().ensure(t => t > 0);
        this._numPartitions = numPartitions;

        given(flush, "flush").ensureHasValue().ensureIsBoolean();
        this._flush = flush;
    }


    public subscribe(): Topic
    {
        this._publishOnly = false;

        return this;
    }

    /**
     * @param partitionAffinity  this should be in the format `${lowerLimitPartitionNumber}-${upperLimitPartitionNumber}`
     * These Partition numbers are INCLUSIVE and should be in the range [0, the number of partitions configured - 1]
     */
    public configurePartitionAffinity(partitionAffinity: `${number}-${number}`): Topic
    {
        given(partitionAffinity, "partitionAffinity").ensureHasValue().ensureIsString()
            .ensure(t => t.contains("-") && t.trim().split("-").length === 2 && t.trim().split("-")
                .every(u => TypeHelper.parseNumber(u) != null), "invalid format");

        const [lower, upper] = partitionAffinity.trim().split("-").map(t => Number.parseInt(t));

        if (lower < 0 || lower >= this._numPartitions || upper < 0 || upper >= this._numPartitions || upper < lower)
            throw new ArgumentException("partitionAffinity", "invalid value");

        const partitions = new Array<number>();
        for (let i = lower; i <= upper; i++)
            partitions.push(i);

        this._partitionAffinity = partitions;

        return this;
    }

    public disable(): Topic
    {
        this._isDisabled = true;

        return this;
    }
}