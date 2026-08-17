import * as otelApi from "@opentelemetry/api";
import {
    AggregationTemporality,
    InMemoryMetricExporter,
    MeterProvider,
    PeriodicExportingMetricReader,
    type DataPoint,
    type MetricData
} from "@opentelemetry/sdk-metrics";


/**
 * Attribute keys that must never appear on a metric. All of them are unbounded, and all of
 * them sit in ready-made attribute blocks in the tracing code, where they are correct --
 * so copy-pasting a span's attributes into a metric call is the most likely way this
 * blows up cardinality.
 */
export const FORBIDDEN_METRIC_ATTRIBUTES: ReadonlyArray<string> = [
    "messaging.message.id",
    "messaging.message.conversation_id",
    "event.id",
    "partitionKey"
];


export interface TestMetrics
{
    collect(): Promise<Array<MetricData>>;
    shutdown(): Promise<void>;
}


/**
 * Registers an in-memory MeterProvider as the global one and returns a handle for
 * deterministic collection.
 *
 * The export interval is set absurdly high on purpose: collection is driven exclusively by
 * `forceFlush()`, so tests never sleep on an export timer and never flake.
 *
 * Temporality matters for asynchronous instruments. CUMULATIVE (the default, and what you
 * want for asserting totals) deliberately retains series that were reported previously, so a
 * series that stops being observed keeps showing up with its last value. Pass DELTA when the
 * assertion is that a series has *disappeared*.
 */
export function installTestMeterProvider(
    temporality: AggregationTemporality = AggregationTemporality.CUMULATIVE): TestMetrics
{
    // setGlobalMeterProvider refuses to overwrite an already-registered global, so any
    // previous one has to be cleared first.
    otelApi.metrics.disable();

    const exporter = new InMemoryMetricExporter(temporality);
    const reader = new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: 24 * 60 * 60 * 1000,
        exportTimeoutMillis: 30 * 1000
    });
    const provider = new MeterProvider({ readers: [reader] });

    otelApi.metrics.setGlobalMeterProvider(provider);

    return {
        collect: async (): Promise<Array<MetricData>> =>
        {
            exporter.reset();
            await provider.forceFlush();

            return exporter.getMetrics()
                .flatMap(resourceMetrics => resourceMetrics.scopeMetrics)
                .filter(scopeMetrics => scopeMetrics.scope.name === "n-eda")
                .flatMap(scopeMetrics => scopeMetrics.metrics);
        },
        shutdown: async (): Promise<void> =>
        {
            await provider.shutdown();

            // Returns the global provider to NOOP. The provider-identity cache in
            // src/metrics.ts handles this correctly; a one-shot memo would leave a
            // shut-down provider cached and the next test file's metrics would vanish.
            otelApi.metrics.disable();
        }
    };
}


export function findMetric(metrics: ReadonlyArray<MetricData>, name: string): MetricData | null
{
    return metrics.find(t => t.descriptor.name === name) ?? null;
}

export function requireMetric(metrics: ReadonlyArray<MetricData>, name: string): MetricData
{
    const metric = findMetric(metrics, name);
    if (metric == null)
        throw new Error(`Expected metric '${name}' was not collected. Collected: ${metrics.map(t => t.descriptor.name).join(", ")}`);

    return metric;
}

/**
 * Returns the datapoints of a metric whose attributes match every entry in `match`.
 */
export function dataPointsWhere(metric: MetricData, match: Record<string, unknown>)
    : Array<DataPoint<unknown>>
{
    return (<Array<DataPoint<unknown>>>metric.dataPoints)
        .filter(dataPoint => Object.entries(match)
            .every(([key, value]) => dataPoint.attributes[key] === value));
}
