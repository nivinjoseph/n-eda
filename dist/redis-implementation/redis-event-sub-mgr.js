import { __esDecorate, __runInitializers, __setFunctionName } from "tslib";
import { EdaManager } from "../eda-manager.js";
// import * as Redis from "redis";
import { given } from "@nivinjoseph/n-defensive";
import { ObjectDisposedException } from "@nivinjoseph/n-exception";
import { inject } from "@nivinjoseph/n-ject";
import { Delay } from "@nivinjoseph/n-util";
import { AwsLambdaProxyProcessor } from "./aws-lambda-proxy-processor.js";
import { Broker } from "./broker.js";
import { Consumer } from "./consumer.js";
import { DefaultProcessor } from "./default-processor.js";
import { GrpcClientFactory } from "./grpc-client-factory.js";
import { GrpcProxyProcessor } from "./grpc-proxy-processor.js";
import { Monitor } from "./monitor.js";
import { RpcProxyProcessor } from "./rpc-proxy-processor.js";
// import { ConsumerProfiler } from "./consumer-profiler";
// import { ProfilingConsumer } from "./profiling-consumer";
// public
let RedisEventSubMgr = (() => {
    let _classDecorators = [inject("EdaRedisClient", "Logger")];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var RedisEventSubMgr = _classThis = class {
        constructor(redisClient, logger) {
            this._brokers = new Array();
            this._monitor = null;
            this._isDisposing = false;
            this._isDisposed = false;
            this._disposePromise = null;
            this._manager = null;
            this._isConsuming = false;
            given(redisClient, "redisClient").ensureHasValue().ensureIsObject();
            this._client = redisClient;
            given(logger, "logger").ensureHasValue().ensureIsObject();
            this._logger = logger;
        }
        initialize(manager) {
            given(manager, "manager").ensureHasValue().ensureIsObject().ensureIsType(EdaManager);
            if (this._isDisposed)
                throw new ObjectDisposedException(this);
            given(this, "this").ensure(t => !t._manager, "already initialized");
            this._manager = manager;
            // if (this._manager.metricsEnabled)
            //     ConsumerProfiler.initialize();
        }
        async consume() {
            if (this._isDisposed)
                throw new ObjectDisposedException(this);
            given(this, "this").ensure(t => !!t._manager, "not initialized");
            if (!this._isConsuming) {
                this._isConsuming = true;
                const monitorConsumers = new Array();
                this._manager.topics.forEach(topic => {
                    if (topic.isDisabled || topic.publishOnly)
                        return;
                    let partitions = topic.partitionAffinity ? [...topic.partitionAffinity] : null;
                    if (partitions == null) {
                        partitions = new Array();
                        for (let partition = 0; partition < topic.numPartitions; partition++)
                            partitions.push(partition);
                    }
                    const consumers = partitions
                        .map(partition => new Consumer(this._client, this._manager, topic.name, partition, topic.flush));
                    let processors;
                    if (this._manager.awsLambdaProxyEnabled)
                        processors = consumers.map(_ => new AwsLambdaProxyProcessor(this._manager));
                    else if (this._manager.rpcProxyEnabled)
                        processors = consumers.map(_ => new RpcProxyProcessor(this._manager));
                    else if (this._manager.grpcProxyEnabled) {
                        const grpcClientFactory = new GrpcClientFactory(this._manager);
                        processors = consumers.map(_ => new GrpcProxyProcessor(this._manager, grpcClientFactory));
                    }
                    else
                        processors = consumers.map(_ => new DefaultProcessor(this._manager, this.onEventReceived.bind(this)));
                    const broker = new Broker(topic, consumers, processors);
                    this._brokers.push(broker);
                    monitorConsumers.push(...consumers);
                    // const monitor = new Monitor(this._client, consumers, this._logger);
                    // this._monitors.push(monitor);
                });
                this._monitor = new Monitor(this._client, this._brokers, monitorConsumers, this._logger);
                await this._monitor.start();
                this._brokers.forEach(t => t.initialize());
            }
            while (!this._isDisposed) {
                await Delay.seconds(5);
            }
        }
        dispose() {
            if (!this._isDisposing) {
                this._isDisposing = true;
                console.warn("Disposing EventSubMgr");
                this._disposePromise = Promise.all([
                    // ...this._monitors.map(t => t.dispose()),
                    this._monitor.dispose(),
                    ...this._brokers.map(t => t.dispose())
                ])
                    .catch(e => console.error(e))
                    .finally(() => {
                    this._isDisposed = true;
                    console.warn("EventSubMgr disposed");
                });
                // if (this._manager.metricsEnabled)
                // {
                //     await Delay.seconds(3);
                //     ConsumerProfiler.aggregate(this._manager.consumerName, this._consumers.map(t => (<ProfilingConsumer>t).profiler));
                // }
            }
            return this._disposePromise;
        }
        onEventReceived(scope, topic, event) {
            given(scope, "scope").ensureHasValue().ensureIsObject();
            given(topic, "topic").ensureHasValue().ensureIsString();
            given(event, "event").ensureHasValue().ensureIsObject();
        }
    };
    __setFunctionName(_classThis, "RedisEventSubMgr");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        RedisEventSubMgr = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return RedisEventSubMgr = _classThis;
})();
export { RedisEventSubMgr };
//# sourceMappingURL=redis-event-sub-mgr.js.map