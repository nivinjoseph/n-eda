import { given } from "@nivinjoseph/n-defensive";
import { ObjectDisposedException } from "@nivinjoseph/n-exception";
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
export class Monitor implements Disposable
{
    private readonly _client: Redis;
    private readonly _consumers = new Map<string, Consumer>();
    private readonly _logger: Logger;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    private readonly _listener: Function;
    private _isRunning = false;
    private _isDisposed = false;


    private get _channels(): Array<string> { return [...this._consumers.values()].map(t => `${t.id}-changed`); }


    public constructor(client: Redis, consumers: ReadonlyArray<Consumer>, logger: Logger)
    {
        // All validations run before the connection is duplicated: the throw path (every topic
        // publish-only/disabled yields an empty consumer list) must not leak a live connection that no
        // dispose() can ever reach.
        given(client, "client").ensureHasValue().ensureIsObject();
        given(consumers, "consumers").ensureHasValue().ensureIsArray().ensureIsNotEmpty();
        given(logger, "logger").ensureHasValue().ensureIsObject();

        this._client = client.duplicate();
        consumers.forEach(consumer =>
        {
            this._consumers.set(consumer.id, consumer);
        });
        this._logger = logger;

        this._listener = (_channel: string, id: string): void =>
        {
            // Optional: this runs inside an emitter callback, where a throw on an unrecognized payload would
            // go unhandled. A missed wake-up only costs one idle poll interval of latency.
            this._consumers.get(id)?.awaken();
        };
    }


    public async start(): Promise<void>
    {
        if (this._isDisposed)
            throw new ObjectDisposedException("Monitor");

        if (this._isRunning)
            return;

        // The flag is only committed once the subscription exists; flipping it before the await would turn a
        // transiently failed start() into a permanent no-op behind the guard above.
        await this._client.subscribe(...this._channels);
        this._client.on("message", this._listener as any);
        this._isRunning = true;
    }

    public async dispose(): Promise<void>
    {
        if (this._isDisposed)
            return;

        this._isDisposed = true;

        // Only tear the subscription down if start() actually established one. The connection itself is
        // created in the constructor, so it has to be closed either way.
        if (this._isRunning)
        {
            this._client.off("message", this._listener as any);

            await this._client.unsubscribe(...this._channels)
                .catch(e => this._logger.logError(e));
        }

        // The sub-mgr awaits this inside a Promise.all during shutdown, so a connection that is already gone
        // must not reject and take the rest of the teardown with it.
        await this._client.quit()
            .catch(e => this._logger.logError(e));
    }
}
