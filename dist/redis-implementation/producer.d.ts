import { Logger } from "@nivinjoseph/n-log";
import { Redis } from "ioredis";
import { EdaEvent } from "../eda-event.js";
export declare class Producer {
    private readonly _edaPrefix;
    private readonly _key;
    private readonly _client;
    private readonly _logger;
    private readonly _topic;
    private readonly _ttlSeconds;
    private readonly _partition;
    get id(): string;
    get writeIndexKey(): string;
    constructor(key: string, client: Redis, logger: Logger, topic: string, ttlMinutes: number, partition: number);
    produce(...events: ReadonlyArray<EdaEvent>): Promise<void>;
    private _compressEvents;
    private _incrementPartitionWriteIndex;
    private _storeEvents;
}
//# sourceMappingURL=producer.d.ts.map