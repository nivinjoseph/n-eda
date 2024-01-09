import { EdaManager } from "../eda-manager.js";
import { EventSubMgr } from "../event-sub-mgr.js";
// import * as Redis from "redis";
import { given } from "@nivinjoseph/n-defensive";
import { ObjectDisposedException } from "@nivinjoseph/n-exception";
import { ServiceLocator, inject } from "@nivinjoseph/n-ject";
import { Logger } from "@nivinjoseph/n-log";
import { Delay } from "@nivinjoseph/n-util";
import { Redis } from "ioredis";
import { EdaEvent } from "../eda-event.js";
import { AwsLambdaProxyProcessor } from "./aws-lambda-proxy-processor.js";
import { Broker } from "./broker.js";
import { Consumer } from "./consumer.js";
import { DefaultProcessor } from "./default-processor.js";
import { GrpcClientFactory } from "./grpc-client-factory.js";
import { GrpcProxyProcessor } from "./grpc-proxy-processor.js";
import { Monitor } from "./monitor.js";
import { Processor } from "./processor.js";
import { RpcProxyProcessor } from "./rpc-proxy-processor.js";
// import { ConsumerProfiler } from "./consumer-profiler";
// import { ProfilingConsumer } from "./profiling-consumer";

// public
@inject("EdaRedisClient", "Logger")
export class RedisEventSubMgr implements EventSubMgr
{
    private readonly _client: Redis;
    private readonly _logger: Logger;
    private readonly _brokers = new Array<Broker>();
    private _monitor: Monitor = null as any;

    private _isDisposing = false;
    private _isDisposed = false;
    private _disposePromise: Promise<void> | null = null;
    private _manager: EdaManager = null as any;
    private _isConsuming = false;


    public constructor(redisClient: Redis, logger: Logger)
    {
        given(redisClient, "redisClient").ensureHasValue().ensureIsObject();
        this._client = redisClient;

        given(logger, "logger").ensureHasValue().ensureIsObject();
        this._logger = logger;
    }


    public initialize(manager: EdaManager): void
    {
        given(manager, "manager").ensureHasValue().ensureIsObject().ensureIsType(EdaManager);

        if (this._isDisposed)
            throw new ObjectDisposedException(this);

        given(this, "this").ensure(t => !t._manager, "already initialized");

        this._manager = manager;
        // if (this._manager.metricsEnabled)
        //     ConsumerProfiler.initialize();
    }

    public async consume(): Promise<void>
    {
        if (this._isDisposed)
            throw new ObjectDisposedException(this);

        given(this, "this").ensure(t => !!t._manager, "not initialized");

        if (!this._isConsuming)
        {
            this._isConsuming = true;

            const monitorConsumers = new Array<Consumer>();

            this._manager.topics.forEach(topic =>
            {
                if (topic.isDisabled || topic.publishOnly)
                    return;

                let partitions = topic.partitionAffinity ? [...topic.partitionAffinity] : null;
                if (partitions == null)
                {
                    partitions = new Array<number>();
                    for (let partition = 0; partition < topic.numPartitions; partition++)
                        partitions.push(partition);
                }

                const consumers = partitions
                    .map(partition => new Consumer(this._client, this._manager, topic.name, partition, topic.flush));

                let processors: Array<Processor>;
                if (this._manager.awsLambdaProxyEnabled)
                    processors = consumers.map(_ => new AwsLambdaProxyProcessor(this._manager));
                else if (this._manager.rpcProxyEnabled)
                    processors = consumers.map(_ => new RpcProxyProcessor(this._manager));
                else if (this._manager.grpcProxyEnabled)
                {
                    const grpcClientFactory = new GrpcClientFactory(this._manager);
                    processors = consumers.map(_ => new GrpcProxyProcessor(this._manager, grpcClientFactory));
                }
                else
                    processors = consumers.map(_ => new DefaultProcessor(this._manager, this.onEventReceived.bind(this)));

                const broker = new Broker(consumers, processors);
                this._brokers.push(broker);

                monitorConsumers.push(...consumers);
                // const monitor = new Monitor(this._client, consumers, this._logger);
                // this._monitors.push(monitor);
            });

            this._monitor = new Monitor(this._client, monitorConsumers, this._logger);
            await this._monitor.start();

            this._brokers.forEach(t => t.initialize());
        }

        while (!this._isDisposed)
        {
            await Delay.seconds(5);
        }
    }

    public dispose(): Promise<void>
    {
        if (!this._isDisposing)
        {
            this._isDisposing = true;
            console.warn("Disposing EventSubMgr");
            this._disposePromise = Promise.all([
                // ...this._monitors.map(t => t.dispose()),
                this._monitor.dispose(),
                ...this._brokers.map(t => t.dispose())
            ])
                .catch(e => console.error(e))
                .finally(() =>
                {
                    this._isDisposed = true;
                    console.warn("EventSubMgr disposed");
                }) as unknown as Promise<void>;

            // if (this._manager.metricsEnabled)
            // {
            //     await Delay.seconds(3);

            //     ConsumerProfiler.aggregate(this._manager.consumerName, this._consumers.map(t => (<ProfilingConsumer>t).profiler));
            // }
        }

        return this._disposePromise!;
    }


    protected onEventReceived(scope: ServiceLocator, topic: string, event: EdaEvent): void
    {
        given(scope, "scope").ensureHasValue().ensureIsObject();
        given(topic, "topic").ensureHasValue().ensureIsString();
        given(event, "event").ensureHasValue().ensureIsObject();
    }
}