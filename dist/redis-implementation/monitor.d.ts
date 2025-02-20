import { Logger } from "@nivinjoseph/n-log";
import { Disposable } from "@nivinjoseph/n-util";
import { Redis } from "ioredis";
import { Consumer } from "./consumer.js";
import { Broker } from "./broker.js";
export declare class Monitor implements Disposable {
    private readonly _client;
    private readonly _brokers;
    private readonly _consumers;
    private readonly _logger;
    private readonly _listener;
    private _metricsInterval;
    private _isRunning;
    private _isDisposed;
    constructor(client: Redis, brokers: ReadonlyArray<Broker>, consumers: ReadonlyArray<Consumer>, logger: Logger);
    start(): Promise<void>;
    dispose(): Promise<void>;
    private _initializeMetrics;
}
//# sourceMappingURL=monitor.d.ts.map