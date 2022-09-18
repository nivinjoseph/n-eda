import { Disposable } from "@nivinjoseph/n-util";
import * as Redis from "redis";
import { EdaManager } from "../eda-manager";
import { Broker } from "./broker";
export declare class Consumer implements Disposable {
    private readonly _edaPrefix;
    private readonly _defaultDelayMS;
    private readonly _client;
    private readonly _manager;
    private readonly _logger;
    private readonly _topic;
    private readonly _partition;
    private readonly _id;
    private readonly _cleanKeys;
    private readonly _trackedKeysKey;
    private readonly _flush;
    private _isDisposed;
    private _trackedKeysArray;
    private _trackedKeysSet;
    private _keysToTrack;
    private _consumePromise;
    private _broker;
    get id(): string;
    constructor(client: Redis.RedisClient, manager: EdaManager, topic: string, partition: number, flush?: boolean);
    registerBroker(broker: Broker): void;
    consume(): void;
    dispose(): Promise<void>;
    private _beginConsume;
    private _attemptRoute;
    private _fetchPartitionWriteAndConsumerPartitionReadIndexes;
    private _incrementConsumerPartitionReadIndex;
    private _retrieveEvent;
    private _batchRetrieveEvents;
    private _track;
    private _saveTrackedKeys;
    private _purgeTrackedKeys;
    private _loadTrackedKeys;
    private _decompressEvents;
    private _removeKeys;
}
