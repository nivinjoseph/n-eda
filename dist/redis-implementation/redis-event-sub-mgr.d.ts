import { EventSubMgr } from "../event-sub-mgr";
import { EdaManager } from "../eda-manager";
import Redis from "ioredis";
import { ServiceLocator } from "@nivinjoseph/n-ject";
import { EdaEvent } from "../eda-event";
import { Logger } from "@nivinjoseph/n-log";
export declare class RedisEventSubMgr implements EventSubMgr {
    private readonly _client;
    private readonly _logger;
    private readonly _brokers;
    private _monitor;
    private _isDisposing;
    private _isDisposed;
    private _disposePromise;
    private _manager;
    private _isConsuming;
    constructor(redisClient: Redis, logger: Logger);
    initialize(manager: EdaManager): void;
    consume(): Promise<void>;
    dispose(): Promise<void>;
    protected onEventReceived(scope: ServiceLocator, topic: string, event: EdaEvent): void;
}
