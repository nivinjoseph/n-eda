import { given } from "@nivinjoseph/n-defensive";
import { ObjectDisposedException } from "@nivinjoseph/n-exception";
import { Logger } from "@nivinjoseph/n-log";
import { Disposable } from "@nivinjoseph/n-util";
import { Redis } from "ioredis";
import { Consumer } from "./consumer.js";


export class Monitor implements Disposable
{
    private readonly _client: Redis;
    private readonly _consumers = new Map<string, Consumer>();
    // @ts-expect-error: not used atm
    private readonly _logger: Logger;
    private readonly _listener: Function;
    private _isRunning = false;
    private _isDisposed = false;


    public constructor(client: Redis, consumers: ReadonlyArray<Consumer>, logger: Logger)
    {
        given(client, "client").ensureHasValue().ensureIsObject();
        this._client = client.duplicate();

        given(consumers, "consumers").ensureHasValue().ensureIsArray().ensureIsNotEmpty();
        consumers.forEach(consumer =>
        {
            this._consumers.set(consumer.id, consumer);
        });

        given(logger, "logger").ensureHasValue().ensureIsObject();
        this._logger = logger;

        this._listener = (_channel: string, id: string): void =>
        {
            // console.log(_channel, id);
            this._consumers.get(id)!.awaken();
        };
    }


    public async start(): Promise<void>
    {
        if (this._isDisposed)
            throw new ObjectDisposedException("Monitor");

        if (this._isRunning)
            return;

        this._isRunning = true;

        await this._client.subscribe(...[...this._consumers.values()].map(t => `${t.id}-changed`));
        this._client.on("message", this._listener as any);
    }

    public async dispose(): Promise<void>
    {
        this._isRunning = false;
        if (this._isDisposed)
            return;

        this._isDisposed = true;
        this._client.off("message", this._listener as any);
        await this._client.unsubscribe(...[...this._consumers.values()].map(t => `${t.id}-changed`));
        await this._client.quit();
    }
}