# Observability: partition metrics

n-eda emits per-partition lag and throughput as structured log lines, so they can be shipped to a log
platform, parsed into facets, and turned into dashboard metrics without a separate metrics pipeline.

This document covers the log contract and how to wire it up in Datadog. For the runtime that produces
it, see `MetricsReporter` in `src/redis-implementation/metrics-reporter.ts`.

## What gets emitted

Every reporting tick, `MetricsReporter` emits **one log line per topic-partition** this process owns.
Each line's message is a flat JSON object:

```json
{"logType":"n-eda.partition-metrics","topic":"orders","partition":3,"consumerGroupId":"billing-svc",
 "lag":42,"writeIndex":1000,"readIndex":958,"productionRate":12.5,"consumptionRate":11.75,
 "sampledAt":1755600000000,"sampleAgeMs":4200}
```

| Field | Meaning |
|---|---|
| `logType` | Always `n-eda.partition-metrics`. The discriminator your pipeline filters on. |
| `topic` | Topic name. |
| `partition` | Partition number within the topic. |
| `consumerGroupId` | The consumer group whose read offset produced `readIndex`, `lag`, and `consumptionRate` (from `registerEventSubscriptionManager`). Distinct groups consuming the same topic report independent figures. |
| `lag` | `writeIndex - readIndex`, clamped at `0` — publish batches this consumer group is behind. **The number you alert on.** |
| `writeIndex` | The producer's current slot counter. |
| `readIndex` | This consumer group's current offset. |
| `productionRate` | Batches written per minute, two decimals. `0` when there is no usable baseline: a partition's first report, or an index that regressed (Redis flush/eviction). |
| `consumptionRate` | Batches consumed per minute, two decimals. `0` when there is no usable baseline. |
| `sampledAt` | Epoch ms when the consumer sampled these indexes. |
| `sampleAgeMs` | How old the sample was when logged — `tickTime - sampledAt`, clamped at `0`. |

A batch is one `SETEX`ed slot, which may hold several events; these are batch rates, not event rates.

### Why one line per partition

Log-based metrics can only read **flat attributes off a single log event**. A platform will not fan an
array of partition objects out into one metric point each, so an aggregate line carrying every topic
and partition cannot produce a per-partition metric no matter what pipeline is written against it.
Hence: one flat line each, no nesting.

`PartitionMetricRecord` is typed to hold only scalars and a test asserts that every emitted value is
one. Nesting a value here breaks dashboards silently rather than loudly, so keep it flat.

### Why the rates are per minute

Consumers refresh these figures on their own schedule, independent of the reporter's timer, so the
reporter will sometimes re-log a record no consumer has refreshed. A per-minute **rate** re-logged is
merely stale; a raw delta re-logged would read as a second, phantom batch of the same events. Use
`sampleAgeMs` to tell fresh points from stale ones.

### Why `sampledAt` and not `timestamp`

`timestamp` is a reserved attribute in Datadog. Its date remapper would treat the value as the log
event's own time and shift the event on the timeline. Don't rename it back.

## Cadence and volume

Default is one tick per minute, adjustable at bootstrap (positive, at most 2^31-1 ms ≈ 24.8 days —
Node's timer maximum; beyond it `configureMetricsInterval` throws):

```typescript
manager.configureMetricsInterval(Duration.fromMinutes(5));
```

Volume is **`topics × partitions` lines per interval, per process**. A service owning 5 topics of 16
partitions emits 80 lines/min — roughly 115k lines/day per instance, which most platforms bill on
ingest. Widen the interval to trade dashboard resolution for cost.

Consumers report to their `Broker` at half the configured interval, so on a healthy consume loop a
logged line is never more than one report stale. A loop blocked mid-batch (a handler stuck in its
retry ladder can hold an iteration for minutes) pauses reporting for that partition — `sampleAgeMs`
is what makes that visible, which is one more reason to keep the staleness filter below.

## Datadog setup

Verified against the Datadog docs (log preprocessing, Grok parsing, log search syntax, and
logs-to-metrics pages) as of August 2026.

n-log's JSON format already wraps each line in `{source, service, env, level, message, dateTime, time}`.
Datadog preprocesses whole-line JSON using its reserved-attribute lookup lists, so `service` (service
list), `level` (status list: `status`, `severity`, `level`) and `message` map automatically — you do
not need to add them to the payload. Two things it does **not** do automatically:

- **It does not look inside `message`.** A JSON string nested in the message attribute needs a parser
  (step 1).
- **It does not read the log's own time.** The date lookup list is `timestamp`, `date`, `_timestamp`,
  `Timestamp`, `eventTime`, `published_date`, `syslog.timestamp` — n-log's `time`/`dateTime` are not
  on it, so events get *intake* time. Usually fine (the reporter logs records the moment it builds
  them); add a **Date Remapper** on `time` if you want the log's own stamp.

### 1. Parse the message

In **Logs → Pipelines**, add a pipeline filtered to your service, containing a **Grok Parser**
processor. Grok parsers apply to the `message` attribute by default, and the `json` filter parses the
whole payload in one rule:

```
rule %{data::json}
```

That lifts `logType`, `topic`, `partition`, `lag`, and the rest to top-level attributes (`@topic`,
`@lag`, …). The numeric fields are emitted as JSON numbers, which is what metric generation requires —
if they arrive as strings, the parser is misconfigured.

### 2. Create facets

In the Log Explorer, add facets on `@logType`, `@topic`, and `@partition`, and a **measure** (numeric
facet) on `@sampleAgeMs`. Datadog requires a facet before numeric comparison operators
(`@sampleAgeMs:<90000`) work in queries, and facets make the group-bys below selectable.

### 3. Generate metrics

Datadog generates two kinds of metrics from logs: **count** metrics (log occurrences) and
**distribution** metrics (a numeric attribute; there is no gauge type). A distribution automatically
provides `count`, `min`, `max`, `sum`, and `avg` aggregations, with optional percentiles. In
**Logs → Generate Metrics**, add a distribution per figure:

| Query | Field | Metric name | Group by |
|---|---|---|---|
| `@logType:n-eda.partition-metrics` | `@lag` | `neda.partition.lag` | `@topic`, `@partition` |
| `@logType:n-eda.partition-metrics` | `@productionRate` | `neda.partition.production_rate` | `@topic`, `@partition` |
| `@logType:n-eda.partition-metrics` | `@consumptionRate` | `neda.partition.consumption_rate` | `@topic`, `@partition` |

Query the distributions with `max` for lag (worst partition wins) and `avg` for the rates. Because a
tick may re-log an unrefreshed record, duplicates appear as extra identical samples — harmless to
`max`/`avg`, which is exactly why the payload carries normalized rates rather than raw deltas (a
duplicate delta summed as a count would double-count).

`service` and `env` come from the envelope, so you can scope any dashboard by them without adding them
as group-bys here. Add `@consumerGroupId` to the group-bys only if multiple consumer groups read the
same topics within one Datadog org — otherwise `service` already separates them and the extra
cardinality is wasted. Keep group-bys bounded — Datadog bills log-based metrics by cardinality.

### 4. Filter out stale points

A partition whose consumer has wedged keeps reporting its last known figures. Exclude them in the
metric's filter query (requires the `@sampleAgeMs` measure from step 2):

```
@logType:n-eda.partition-metrics @sampleAgeMs:<90000
```

Tune the bound to roughly 1.5× your configured interval. `sampleAgeMs` is precomputed precisely
because log query languages cannot do date arithmetic.

### 5. Alerting

Prefer a **monitor on `neda.partition.lag`** over alerting on log text — it gives you per-partition
thresholds, and recovery detection.

n-eda also logs a warning line when a partition exceeds a built-in lag threshold of 1000 batches
(`maxAcceptableLag` in `metrics-reporter.ts`). That line is human-readable and carries **no** `logType`,
so it never reaches the metrics pipeline above. It is there for someone tailing logs; the monitor is
the real alerting path.

## Suggested dashboard

- **Lag by partition** — `neda.partition.lag`, max, grouped by `@topic`/`@partition`. A partition
  climbing while others stay flat is a stuck consumer or a hot partition key.
- **Production vs consumption** — the two rates overlaid per topic. Consumption below production is
  the leading indicator; lag is the lagging one.
- **Idle partitions** — count of partitions where both rates are `0`. Expected for sparse topics;
  suspicious for busy ones, and often the sign of a partition-affinity misconfiguration.

## Related

- [known-issues.md](known-issues.md) — including the unwired `consumer-profiler.ts` / `enableMetrics()`
- [../ARCHITECTURE.md](../ARCHITECTURE.md) — the consume loop that produces these figures
