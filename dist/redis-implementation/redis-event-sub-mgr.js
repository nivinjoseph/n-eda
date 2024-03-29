"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisEventSubMgr = void 0;
const tslib_1 = require("tslib");
const eda_manager_1 = require("../eda-manager");
// import * as Redis from "redis";
const ioredis_1 = require("ioredis");
const n_defensive_1 = require("@nivinjoseph/n-defensive");
const consumer_1 = require("./consumer");
const n_util_1 = require("@nivinjoseph/n-util");
const n_ject_1 = require("@nivinjoseph/n-ject");
const n_exception_1 = require("@nivinjoseph/n-exception");
const broker_1 = require("./broker");
const default_processor_1 = require("./default-processor");
const aws_lambda_proxy_processor_1 = require("./aws-lambda-proxy-processor");
const rpc_proxy_processor_1 = require("./rpc-proxy-processor");
const grpc_proxy_processor_1 = require("./grpc-proxy-processor");
const grpc_client_factory_1 = require("./grpc-client-factory");
const monitor_1 = require("./monitor");
// import { ConsumerProfiler } from "./consumer-profiler";
// import { ProfilingConsumer } from "./profiling-consumer";
// public
let RedisEventSubMgr = class RedisEventSubMgr {
    constructor(redisClient, logger) {
        this._brokers = new Array();
        this._monitor = null;
        this._isDisposing = false;
        this._isDisposed = false;
        this._disposePromise = null;
        this._manager = null;
        this._isConsuming = false;
        (0, n_defensive_1.given)(redisClient, "redisClient").ensureHasValue().ensureIsObject();
        this._client = redisClient;
        (0, n_defensive_1.given)(logger, "logger").ensureHasValue().ensureIsObject();
        this._logger = logger;
    }
    initialize(manager) {
        (0, n_defensive_1.given)(manager, "manager").ensureHasValue().ensureIsObject().ensureIsType(eda_manager_1.EdaManager);
        if (this._isDisposed)
            throw new n_exception_1.ObjectDisposedException(this);
        (0, n_defensive_1.given)(this, "this").ensure(t => !t._manager, "already initialized");
        this._manager = manager;
        // if (this._manager.metricsEnabled)
        //     ConsumerProfiler.initialize();
    }
    consume() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (this._isDisposed)
                throw new n_exception_1.ObjectDisposedException(this);
            (0, n_defensive_1.given)(this, "this").ensure(t => !!t._manager, "not initialized");
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
                        .map(partition => new consumer_1.Consumer(this._client, this._manager, topic.name, partition, topic.flush));
                    let processors;
                    if (this._manager.awsLambdaProxyEnabled)
                        processors = consumers.map(_ => new aws_lambda_proxy_processor_1.AwsLambdaProxyProcessor(this._manager));
                    else if (this._manager.rpcProxyEnabled)
                        processors = consumers.map(_ => new rpc_proxy_processor_1.RpcProxyProcessor(this._manager));
                    else if (this._manager.grpcProxyEnabled) {
                        const grpcClientFactory = new grpc_client_factory_1.GrpcClientFactory(this._manager);
                        processors = consumers.map(_ => new grpc_proxy_processor_1.GrpcProxyProcessor(this._manager, grpcClientFactory));
                    }
                    else
                        processors = consumers.map(_ => new default_processor_1.DefaultProcessor(this._manager, this.onEventReceived.bind(this)));
                    const broker = new broker_1.Broker(consumers, processors);
                    this._brokers.push(broker);
                    monitorConsumers.push(...consumers);
                    // const monitor = new Monitor(this._client, consumers, this._logger);
                    // this._monitors.push(monitor);
                });
                this._monitor = new monitor_1.Monitor(this._client, monitorConsumers, this._logger);
                yield this._monitor.start();
                this._brokers.forEach(t => t.initialize());
            }
            while (!this._isDisposed) {
                yield n_util_1.Delay.seconds(5);
            }
        });
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
        (0, n_defensive_1.given)(scope, "scope").ensureHasValue().ensureIsObject();
        (0, n_defensive_1.given)(topic, "topic").ensureHasValue().ensureIsString();
        (0, n_defensive_1.given)(event, "event").ensureHasValue().ensureIsObject();
    }
};
RedisEventSubMgr = tslib_1.__decorate([
    (0, n_ject_1.inject)("EdaRedisClient", "Logger"),
    tslib_1.__metadata("design:paramtypes", [ioredis_1.default, Object])
], RedisEventSubMgr);
exports.RedisEventSubMgr = RedisEventSubMgr;
//# sourceMappingURL=redis-event-sub-mgr.js.map