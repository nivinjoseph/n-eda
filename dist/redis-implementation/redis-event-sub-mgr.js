"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisEventSubMgr = void 0;
const eda_manager_1 = require("../eda-manager");
const Redis = require("redis");
const n_defensive_1 = require("@nivinjoseph/n-defensive");
const consumer_1 = require("./consumer");
const n_util_1 = require("@nivinjoseph/n-util");
const n_ject_1 = require("@nivinjoseph/n-ject");
const n_exception_1 = require("@nivinjoseph/n-exception");
const consumer_profiler_1 = require("./consumer-profiler");
const profiling_consumer_1 = require("./profiling-consumer");
let RedisEventSubMgr = class RedisEventSubMgr {
    constructor(redisClient, logger) {
        this._consumers = new Array();
        this._isDisposed = false;
        this._disposePromise = null;
        this._manager = null;
        this._isConsuming = false;
        n_defensive_1.given(redisClient, "redisClient").ensureHasValue().ensureIsObject();
        this._client = redisClient;
        n_defensive_1.given(logger, "logger").ensureHasValue().ensureIsObject();
        this._logger = logger;
    }
    initialize(manager) {
        n_defensive_1.given(manager, "manager").ensureHasValue().ensureIsObject().ensureIsType(eda_manager_1.EdaManager);
        if (this._isDisposed)
            throw new n_exception_1.ObjectDisposedException(this);
        n_defensive_1.given(this, "this").ensure(t => !t._manager, "already initialized");
        this._manager = manager;
        if (this._manager.metricsEnabled)
            consumer_profiler_1.ConsumerProfiler.initialize();
    }
    consume() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this._isDisposed)
                throw new n_exception_1.ObjectDisposedException(this);
            n_defensive_1.given(this, "this").ensure(t => !!t._manager, "not initialized");
            if (!this._isConsuming) {
                this._isConsuming = true;
                this._manager.topics.forEach(topic => {
                    if (topic.isDisabled || topic.publishOnly)
                        return;
                    if (topic.partitionAffinity != null) {
                        topic.partitionAffinity.forEach(partition => {
                            const consumer = this._manager.metricsEnabled
                                ? new profiling_consumer_1.ProfilingConsumer(this._client, this._manager, topic.name, partition, this.onEventReceived.bind(this))
                                : new consumer_1.Consumer(this._client, this._manager, topic.name, partition, this.onEventReceived.bind(this));
                            this._consumers.push(consumer);
                        });
                    }
                    else {
                        for (let partition = 0; partition < topic.numPartitions; partition++) {
                            const consumer = this._manager.metricsEnabled
                                ? new profiling_consumer_1.ProfilingConsumer(this._client, this._manager, topic.name, partition, this.onEventReceived.bind(this))
                                : new consumer_1.Consumer(this._client, this._manager, topic.name, partition, this.onEventReceived.bind(this));
                            this._consumers.push(consumer);
                        }
                    }
                });
                this._consumers.forEach(t => t.consume());
            }
            while (!this._isDisposed) {
                yield n_util_1.Delay.seconds(2);
            }
        });
    }
    dispose() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this._isDisposed) {
                this._isDisposed = true;
                this._disposePromise = Promise.all(this._consumers.map(t => t.dispose()));
                if (this._manager.metricsEnabled) {
                    yield n_util_1.Delay.seconds(3);
                    consumer_profiler_1.ConsumerProfiler.aggregate(this._manager.consumerName, this._consumers.map(t => t.profiler));
                }
            }
            yield this._disposePromise;
        });
    }
    onEventReceived(scope, topic, event) {
        n_defensive_1.given(scope, "scope").ensureHasValue().ensureIsObject();
        n_defensive_1.given(topic, "topic").ensureHasValue().ensureIsString();
        n_defensive_1.given(event, "event").ensureHasValue().ensureIsObject();
    }
};
RedisEventSubMgr = __decorate([
    n_ject_1.inject("EdaRedisClient", "Logger"),
    __metadata("design:paramtypes", [Redis.RedisClient, Object])
], RedisEventSubMgr);
exports.RedisEventSubMgr = RedisEventSubMgr;
//# sourceMappingURL=redis-event-sub-mgr.js.map