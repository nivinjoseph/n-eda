import { given } from "@nivinjoseph/n-defensive";
import { ObjectDisposedException } from "@nivinjoseph/n-exception";
// import { DefaultScheduler } from "./default-scheduler.js";
import { OptimizedScheduler } from "./optimized-scheduler.js";
import { Topic } from "../topic.js";
export class Broker {
    get topic() { return this._topic; }
    get metrics() { return this._metricsTracker; }
    constructor(topic, consumers, processors) {
        this._metricsTracker = new Map;
        this._isDisposed = false;
        given(topic, "topic").ensureHasValue().ensureIsType(Topic);
        this._topic = topic;
        given(consumers, "consumers").ensureHasValue().ensureIsArray().ensure(t => t.isNotEmpty);
        this._consumers = consumers;
        given(processors, "processors").ensureHasValue().ensureIsArray().ensure(t => t.isNotEmpty)
            .ensure(t => t.length === consumers.length, "length has to match consumers length");
        this._processors = processors;
        this._scheduler = new OptimizedScheduler(processors);
    }
    initialize() {
        this._consumers.forEach(t => t.registerBroker(this));
        this._consumers.forEach(t => t.consume());
    }
    route(routedEvent) {
        if (this._isDisposed)
            return Promise.reject(new ObjectDisposedException("Broker"));
        return this._scheduler.scheduleWork(routedEvent);
    }
    report(partition, writeIndex, readIndex) {
        const lag = writeIndex - readIndex;
        const last = this._metricsTracker.get(partition);
        let lastWriteIndex = writeIndex;
        let lastReadIndex = readIndex;
        if (last != null) {
            lastWriteIndex = last.writeIndex;
            lastReadIndex = last.readIndex;
        }
        this._metricsTracker.set(partition, {
            lag, writeIndex, readIndex,
            productionRate: writeIndex - lastWriteIndex,
            consumptionRate: readIndex - lastReadIndex
        });
    }
    async dispose() {
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