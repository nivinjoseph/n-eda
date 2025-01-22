import { given } from "@nivinjoseph/n-defensive";
import { ObjectDisposedException } from "@nivinjoseph/n-exception";
import { Duration } from "@nivinjoseph/n-util";
export class Monitor {
    constructor(client, brokers, consumers, logger) {
        this._consumers = new Map();
        this._metricsInterval = null;
        this._isRunning = false;
        this._isDisposed = false;
        given(client, "client").ensureHasValue().ensureIsObject();
        this._client = client.duplicate();
        given(brokers, "brokers").ensureHasValue().ensureIsArray().ensureIsNotEmpty();
        this._brokers = brokers;
        given(consumers, "consumers").ensureHasValue().ensureIsArray().ensureIsNotEmpty();
        consumers.forEach(consumer => {
            this._consumers.set(consumer.id, consumer);
        });
        given(logger, "logger").ensureHasValue().ensureIsObject();
        this._logger = logger;
        this._listener = (_channel, id) => {
            // console.log(_channel, id);
            this._consumers.get(id).awaken();
        };
    }
    async start() {
        if (this._isDisposed)
            throw new ObjectDisposedException("Monitor");
        if (this._isRunning)
            return;
        this._isRunning = true;
        this._initializeMetrics();
        await this._client.subscribe(...[...this._consumers.values()].map(t => `${t.id}-changed`));
        this._client.on("message", this._listener);
    }
    async dispose() {
        this._isRunning = false;
        if (this._isDisposed)
            return;
        this._isDisposed = true;
        if (this._metricsInterval != null)
            clearInterval(this._metricsInterval);
        this._client.off("message", this._listener);
        await this._client.unsubscribe(...[...this._consumers.values()].map(t => `${t.id}-changed`));
        await this._client.quit();
    }
    _initializeMetrics() {
        this._metricsInterval = setInterval(() => {
            const metrics = this._brokers.map(broker => ({
                topic: broker.topic.name,
                partitions: [...broker.metrics.entries()]
                    .orderBy(t => t[0])
                    .map(t => (Object.assign({ partition: t[0] }, t[1])))
            }));
            this._logger.logInfo(JSON.stringify(metrics))
                .catch(e => console.error(e));
        }, Duration.fromMinutes(1).toMilliSeconds());
    }
}
//# sourceMappingURL=monitor.js.map