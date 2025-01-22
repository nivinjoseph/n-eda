import { given } from "@nivinjoseph/n-defensive";
import { ObjectDisposedException } from "@nivinjoseph/n-exception";
import { Logger } from "@nivinjoseph/n-log";
import { Disposable, Duration } from "@nivinjoseph/n-util";
import { Redis } from "ioredis";
import { Consumer } from "./consumer.js";
import { Broker } from "./broker.js";


export class Monitor implements Disposable
{
    private readonly _client: Redis;
    private readonly _brokers: ReadonlyArray<Broker>;
    private readonly _consumers = new Map<string, Consumer>();
    private readonly _logger: Logger;
    private readonly _listener: Function;
    private _metricsInterval: NodeJS.Timeout | null = null;
    private _isRunning = false;
    private _isDisposed = false;


    public constructor(client: Redis, brokers: ReadonlyArray<Broker>, consumers: ReadonlyArray<Consumer>, logger: Logger)
    {
        given(client, "client").ensureHasValue().ensureIsObject();
        this._client = client.duplicate();
        
        given(brokers, "brokers").ensureHasValue().ensureIsArray().ensureIsNotEmpty();
        this._brokers = brokers;

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
        
        this._initializeMetrics();

        await this._client.subscribe(...[...this._consumers.values()].map(t => `${t.id}-changed`));
        this._client.on("message", this._listener as any);
    }

    public async dispose(): Promise<void>
    {
        this._isRunning = false;
        if (this._isDisposed)
            return;

        this._isDisposed = true;
        
        if (this._metricsInterval != null)
            clearInterval(this._metricsInterval);
        
        this._client.off("message", this._listener as any);
        await this._client.unsubscribe(...[...this._consumers.values()].map(t => `${t.id}-changed`));
        await this._client.quit();
    }
    
    private _initializeMetrics(): void
    {
        this._metricsInterval = setInterval(() =>
        {
            const metrics = this._brokers.map(broker => ({
                topic: broker.topic.name,
                partitions: [...broker.metrics.entries()]
                    .orderBy(t => t[0])
                    .map(t => ({
                        partition: t[0],
                        ...t[1]
                    }))
            }));
            
            this._logger.logInfo(JSON.stringify(metrics))
                .catch(e => console.error(e));
        }, Duration.fromMinutes(1).toMilliSeconds());
    }
}