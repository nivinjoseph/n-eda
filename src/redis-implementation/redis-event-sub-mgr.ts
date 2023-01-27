import { EventSubMgr } from "../event-sub-mgr";
import { EdaManager } from "../eda-manager";
// import * as Redis from "redis";
import Redis from "ioredis";
import { given } from "@nivinjoseph/n-defensive";
import { Consumer } from "./consumer";
import { Delay } from "@nivinjoseph/n-util";
import { ServiceLocator, inject } from "@nivinjoseph/n-ject";
import { EdaEvent } from "../eda-event";
import { ObjectDisposedException } from "@nivinjoseph/n-exception";
import { Logger } from "@nivinjoseph/n-log";
import { Broker } from "./broker";
import { Processor } from "./processor";
import { DefaultProcessor } from "./default-processor";
import { AwsLambdaProxyProcessor } from "./aws-lambda-proxy-processor";
import { RpcProxyProcessor } from "./rpc-proxy-processor";
import { GrpcProxyProcessor } from "./grpc-proxy-processor";
import { GrpcClientFactory } from "./grpc-client-factory";
import { Monitor } from "./monitor";
// import { ConsumerProfiler } from "./consumer-profiler";
// import { ProfilingConsumer } from "./profiling-consumer";

// public
@inject("EdaRedisClient", "Logger")
export class RedisEventSubMgr implements EventSubMgr
{
    private readonly _client: Redis;
    // @ts-expect-error: not used atm
    private readonly _logger: Logger;
    private readonly _brokers = new Array<Broker>();
    private readonly _monitors = new Array<Monitor>();

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
                
                const monitor = new Monitor(this._client, consumers);
                this._monitors.push(monitor);
            });
            
            this._brokers.forEach(t => t.initialize());
            this._monitors.forEach(t => t.start());
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
                ...this._monitors.map(t => t.dispose()),
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