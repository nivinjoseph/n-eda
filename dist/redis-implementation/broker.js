import { given } from "@nivinjoseph/n-defensive";
import { ObjectDisposedException } from "@nivinjoseph/n-exception";
// import { DefaultScheduler } from "./default-scheduler.js";
import { OptimizedScheduler } from "./optimized-scheduler.js";
import { Topic } from "../topic.js";
import { registerPartitionMetricsSource, unregisterPartitionMetricsSource } from "../metrics.js";
export class Broker {
    _topic;
    _consumerGroupId;
    _consumers;
    _processors;
    _scheduler;
    _metricsTracker = new Map;
    _isDisposed = false;
    get topic() { return this._topic; }
    get topicName() { return this._topic.name; }
    get consumerGroupId() { return this._consumerGroupId; }
    get partitionMetrics() { return this._metricsTracker; }
    get schedulerMetrics() { return this._scheduler.metrics; }
    get trackedKeyCounts() {
        const counts = new Map();
        this._consumers.forEach(t => counts.set(t.partition, t.trackedKeyCount));
        return counts;
    }
    constructor(topic, consumerGroupId, consumers, processors) {
        given(topic, "topic").ensureHasValue().ensureIsType(Topic);
        this._topic = topic;
        given(consumerGroupId, "consumerGroupId").ensureHasValue().ensureIsString();
        this._consumerGroupId = consumerGroupId;
        given(consumers, "consumers").ensureHasValue().ensureIsArray().ensure(t => t.isNotEmpty);
        this._consumers = consumers;
        given(processors, "processors").ensureHasValue().ensureIsArray().ensure(t => t.isNotEmpty)
            .ensure(t => t.length === consumers.length, "length has to match consumers length");
        this._processors = processors;
        this._scheduler = new OptimizedScheduler(processors);
    }
    initialize() {
        registerPartitionMetricsSource(this);
        this._consumers.forEach(t => t.registerBroker(this));
        this._consumers.forEach(t => t.consume());
    }
    route(routedEvent) {
        if (this._isDisposed)
            return Promise.reject(new ObjectDisposedException("Broker"));
        return this._scheduler.scheduleWork(routedEvent);
    }
    /**
     * Called on every consumer poll tick. Deliberately mutates in place rather than
     * allocating, and stores only the raw indexes -- lag and rates are derived at
     * collection time (or by the metrics backend) rather than computed here, because the
     * interval between calls is variable and unknowable from this side.
     */
    report(partition, writeIndex, readIndex, polledAt) {
        const existing = this._metricsTracker.get(partition);
        if (existing != null) {
            existing.writeIndex = writeIndex;
            existing.readIndex = readIndex;
            existing.lastPolledAt = polledAt;
        }
        else
            this._metricsTracker.set(partition, { writeIndex, readIndex, lastPolledAt: polledAt });
    }
    async dispose() {
        // Must happen before anything that can throw. The catch below would otherwise
        // swallow the failure and leave this broker in the registry forever, reporting
        // frozen stale lag.
        unregisterPartitionMetricsSource(this);
        // console.warn("Disposing broker");
        this._isDisposed = true;
        await Promise.all([
            ...this._consumers.map(t => t.dispose()),
            ...this._processors.map(t => t.dispose()),
            this._scheduler.dispose()
        ])
            .then(() => {
            // console.warn("Broker disposed");
        })
            .catch(e => console.error(e));
    }
}
//# sourceMappingURL=broker.js.map