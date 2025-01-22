import { given } from "@nivinjoseph/n-defensive";
import { ArgumentException } from "@nivinjoseph/n-exception";
import { TypeHelper } from "@nivinjoseph/n-util";
// public
export class Topic {
    get name() { return this._name; }
    get ttlMinutes() { return this._ttlMinutes; }
    get numPartitions() { return this._numPartitions; }
    get publishOnly() { return this._publishOnly; }
    get partitionAffinity() { return this._partitionAffinity; }
    get isDisabled() { return this._isDisabled; }
    get flush() { return this._flush; }
    constructor(name, ttlDuration, numPartitions, flush = false) {
        this._publishOnly = true;
        this._partitionAffinity = null;
        this._isDisabled = false;
        given(name, "name").ensureHasValue().ensureIsString();
        this._name = name.trim();
        given(ttlDuration, "ttlDuration").ensureHasValue();
        this._ttlMinutes = ttlDuration.toMinutes(true);
        given(numPartitions, "numPartitions").ensureHasValue().ensureIsNumber().ensure(t => t > 0);
        this._numPartitions = numPartitions;
        given(flush, "flush").ensureHasValue().ensureIsBoolean();
        this._flush = flush;
    }
    subscribe() {
        this._publishOnly = false;
        return this;
    }
    /**
     * @param partitionAffinity  this should be in the format `${lowerLimitPartitionNumber}-${upperLimitPartitionNumber}`
     * These Partition numbers are INCLUSIVE and should be in the range [0, the number of partitions configured - 1]
     */
    configurePartitionAffinity(partitionAffinity) {
        given(partitionAffinity, "partitionAffinity").ensureHasValue().ensureIsString()
            .ensure(t => t.contains("-") && t.trim().split("-").length === 2 && t.trim().split("-")
            .every(u => TypeHelper.parseNumber(u) != null), "invalid format");
        const [lower, upper] = partitionAffinity.trim().split("-").map(t => Number.parseInt(t));
        if (lower < 0 || lower >= this._numPartitions || upper < 0 || upper >= this._numPartitions || upper < lower)
            throw new ArgumentException("partitionAffinity", "invalid value");
        const partitions = new Array();
        for (let i = lower; i <= upper; i++)
            partitions.push(i);
        this._partitionAffinity = partitions;
        return this;
    }
    disable() {
        this._isDisabled = true;
        return this;
    }
}
//# sourceMappingURL=topic.js.map