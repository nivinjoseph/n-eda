import { Logger } from "@nivinjoseph/n-log";
import { Disposable } from "@nivinjoseph/n-util";
import { Redis } from "ioredis";
import { Consumer } from "./consumer.js";
/**
 * Watches every partition's pub/sub doorbell channel and wakes idle consumers the moment a producer writes.
 *
 * Contract: uses a **duplicated** Redis connection, because a client in subscribe mode cannot serve normal
 * commands. Without it consumers would still work, but latency would be the 2.5–5 second idle poll rather
 * than sub-millisecond.
 *
 * Note: requires a non-empty consumer list — which is why registering a subscription manager while every
 * topic is publish-only or disabled fails here. Lag metrics are logged separately by `MetricsReporter`.
 */
export declare class Monitor implements Disposable {
    private readonly _client;
    private readonly _consumers;
    private readonly _logger;
    private readonly _listener;
    private _isRunning;
    private _isDisposed;
    private get _channels();
    constructor(client: Redis, consumers: ReadonlyArray<Consumer>, logger: Logger);
    start(): Promise<void>;
    dispose(): Promise<void>;
}
//# sourceMappingURL=monitor.d.ts.map