# n-eda
Event Driven Architecture framework for Node.js applications

## Overview
n-eda is a powerful Event Driven Architecture framework that provides a robust infrastructure for building event-driven applications in Node.js. It supports various event handling patterns, distributed systems, and integration with different messaging systems.

## Features
- Event-driven architecture implementation
- Support for multiple event handling patterns
- Distributed event handling
- Integration with Redis for event distribution
- AWS Lambda integration
- gRPC and RPC support
- Topic-based event routing
- Partitioned event processing
- Observer pattern implementation
- Dependency injection support
- OpenTelemetry integration for observability

## Installation
```bash
npm install @nivinjoseph/n-eda
# or
yarn add @nivinjoseph/n-eda
```

## Requirements
- Node.js >= 20.10
- Redis (for distributed event handling)

## Quick Start

```typescript
import { EdaManager, Topic, Duration } from "@nivinjoseph/n-eda";

// Create an EDA manager instance
const edaManager = new EdaManager();

// Define topics with retention period and partition count
const userTopic = new Topic("user", Duration.fromMinutes(180), 10);
const orderTopic = new Topic("order", Duration.fromMinutes(180), 10);

// Register a custom EventBus implementation
edaManager.registerEventBus(RedisEventBus);

// Register topics
edaManager.registerTopics(userTopic, orderTopic);

// Register event handlers
@event(UserCreatedEvent)
class UserCreatedEventHandler extends EdaEventHandler<UserCreatedEvent> {
    public async handle(event: UserCreatedEvent): Promise<void> {
        // Handle the event
    }
}

edaManager.registerEventHandlers(UserCreatedEventHandler);

// Bootstrap the system
edaManager.bootstrap();

// Start consuming events
await edaManager.beginConsumption();
```

## Core Concepts

### EventBus
The EventBus is a crucial component of the EDA system that serves as the central hub for event publishing and distribution. It's responsible for:

- Publishing events to the appropriate topics
- Ensuring reliable event delivery
- Managing event routing
- Supporting distributed event processing

To use the EventBus:

```typescript
// Publish an event
await eventBus.publish("UserTopic", new UserCreatedEvent(userData));
```

The EventBus must be registered with the EdaManager before it can be used:

```typescript
// Register a custom EventBus implementation
edaManager.registerEventBus(RedisEventBus);

// Or use the default in-memory implementation
edaManager.registerEventBus(InMemoryEventBus);
```

### Topics
Topics are the primary routing mechanism for events. They help organize and route events to appropriate handlers.

```typescript
// Create a topic with retention period and partition count
const topic = new Topic("user", Duration.fromMinutes(180), 10);
```

### Event Handlers
Event handlers process specific types of events. They can be registered with the EDA manager.

```typescript
@event(UserCreatedEvent)
class UserCreatedEventHandler extends EdaEventHandler<UserCreatedEvent> {
    public async handle(event: UserCreatedEvent): Promise<void> {
        // Handle the event
    }
}
```

### Distributed Processing
n-eda supports distributed event processing through Redis:

```typescript
edaManager.registerEventSubscriptionManager(RedisEventSubMgr, "consumer-group-id");
```

### AWS Lambda Integration
You can proxy events to AWS Lambda functions:

```typescript
edaManager.proxyToAwsLambda({
    functionName: "my-lambda",
    region: "us-east-1"
});
```

### gRPC and RPC Support
n-eda provides support for gRPC and RPC communication:

```typescript
// gRPC
edaManager.proxyToGrpc({
    serviceUrl: "localhost:50051",
    protoPath: "./protos/service.proto"
});

// RPC
edaManager.proxyToRpc({
    serviceUrl: "http://localhost:3000"
});
```

## Advanced Features

### Partitioned Processing
You can implement custom partitioning logic for events:

```typescript
edaManager.usePartitionKeyMapper((event) => event.userId);
```

### Distributed Observer Pattern
Enable distributed observer pattern for cross-service communication:

```typescript
edaManager.enableDistributedObserver(new Topic("system-events"));
```

### Cleanup
Proper cleanup of resources:

```typescript
await edaManager.dispose();
```

## Observability

n-eda emits OpenTelemetry **traces** and **metrics** using the `@opentelemetry/api` package only. It never registers an SDK of its own — register a `TracerProvider` and a `MeterProvider` in your application and n-eda's telemetry flows into them automatically. With no provider registered, every instrument is a no-op and costs nothing, so there is no flag to turn any of this on.

Traces and metrics are both published under the instrumentation scope / meter name **`n-eda`**.

### Traces

Three spans per event, with context propagated across Redis via a `$traceData` field on the serialized event:

| Span | Kind | Emitted by |
|---|---|---|
| `event.<Name> publish` | PRODUCER | the event bus, on publish |
| `event.<Name> receive` | INTERNAL | the consumer, when the event is read |
| `event.<Name> process` | CONSUMER | the processor, wrapping your handler |

Because the `process` span is active while your handler runs, anything your handler instruments is automatically a child of it.

### Metrics

Attribute shorthand below: `topic` = `messaging.destination.name` (the bare topic name), `group` = `messaging.consumer.group.name`, `partition` = `messaging.destination.partition.id`, `error` = `error.type` (the exception class name — never the message).

**Throughput and latency**

| Metric | Type | Unit | Attributes |
|---|---|---|---|
| `messaging.client.sent.messages` | Counter | `{message}` | topic, `n_eda.event.name`, error |
| `messaging.client.consumed.messages` | Counter | `{message}` | topic, group, `n_eda.event.name` |
| `messaging.client.operation.duration` | Histogram | `s` | topic, `messaging.operation.name` (`publish`/`receive`), error |
| `messaging.process.duration` | Histogram | `s` | topic, group, error |
| `n_eda.event.handler.duration` | Histogram | `s` | topic, group, error |
| `n_eda.event.process.attempts` | Counter | `{attempt}` | topic, group, `n_eda.event.name`, `n_eda.outcome` (`success`/`retry`/`exhausted`) |

`messaging.process.duration` covers an event end to end including every retry and its backoff; `n_eda.event.handler.duration` covers a single handler invocation.

**Backlog** — observed at collection time, per partition

| Metric | Type | Unit | Attributes |
|---|---|---|---|
| `n_eda.partition.write_index` | ObservableCounter | `{message}` | topic, partition, group |
| `n_eda.partition.read_index` | ObservableCounter | `{message}` | topic, partition, group |
| `n_eda.partition.lag` | ObservableGauge | `{message}` | topic, partition, group |
| `n_eda.consumer.poll.age` | ObservableGauge | `s` | topic, partition, group |
| `n_eda.tracked_keys.size` | ObservableGauge | `{key}` | topic, partition, group |

Three things to know about these:

1. **The indexes count batches, not events.** A single `publish(topic, ...events)` call becomes one Redis key with one index increment per partition, however many events it carries. So `n_eda.partition.lag` is a backlog of *batches*, and the true event backlog is that multiplied by the average of `n_eda.event.batch.message_count`.
2. **Always read `n_eda.consumer.poll.age` alongside lag.** Lag is refreshed by the consumer's poll loop. If that loop is wedged — stuck retrying a handler, or stalled reading a key — lag stays frozen at its last value precisely when it is actually growing. `lag == 0` is only good news while `poll.age` is small.
3. **Aggregate the indexes with `max` or `avg`, never `sum`.** The write-index key is shared across consumer groups, and replicas of one group consume the same partitions, so several series can legitimately report the same underlying value.

The indexes are monotonic counters on purpose: let your backend's `rate()` derive production and consumption throughput rather than trusting a pre-computed rate.

**Data loss and skips** — there is no dead letter queue, so these counters are the only signal that an event is gone

| Metric | Type | Unit | Attributes |
|---|---|---|---|
| `n_eda.event.dropped` | Counter | `{event}` | topic, group, `n_eda.event.name`, `n_eda.drop.reason` (`read_failed`/`process_failed`) |
| `n_eda.event.skipped` | Counter | `{event}` | topic, group, `n_eda.event.name`, `n_eda.skip.reason` (`duplicate`/`no_registration`/`tracked_keys_cleared`) |
| `n_eda.consumer.loop.errors` | Counter | `{error}` | topic, group, error |

`n_eda.event.dropped` is the metric to alert on. `read_failed` means the consumer could not read a key after 200 attempts and skipped past it; `process_failed` means a handler failed all 10 attempts.

**Redis, scheduling and payloads**

| Metric | Type | Unit | Attributes |
|---|---|---|---|
| `n_eda.redis.command.duration` | Histogram | `s` | `db.operation.name`, `n_eda.component`, error |
| `n_eda.redis.pipeline.errors` | Counter | `{error}` | `db.operation.name`, `n_eda.component` |
| `n_eda.consumer.batch.size` | Histogram | `{message}` | topic, group |
| `n_eda.consumer.read.attempts` | Histogram | `{attempt}` | topic, group |
| `n_eda.scheduler.wait.duration` | Histogram | `s` | topic, group |
| `n_eda.scheduler.queue.depth` | ObservableGauge | `{message}` | topic, group |
| `n_eda.scheduler.partitions.blocked` | ObservableGauge | `{partition}` | topic, group |
| `n_eda.scheduler.partition_keys.tracked` | ObservableGauge | `{partition}` | topic, group |
| `n_eda.scheduler.processors.available` | ObservableGauge | `{processor}` | topic, group |
| `n_eda.event.payload.size` | Histogram | `By` | topic, `n_eda.direction` |
| `n_eda.event.compression.duration` | Histogram | `s` | `n_eda.direction` |
| `n_eda.event.batch.message_count` | Histogram | `{message}` | topic |
| `n_eda.observer.subscriber_lookup.duration` | Histogram | `s` | — |
| `n_eda.observer.subscribers` | Histogram | `{subscriber}` | — |
| `n_eda.proxy.duration` | Histogram | `s` | topic, `n_eda.proxy.kind`, error |

`n_eda.redis.command.duration` records one datapoint per attempt, so failed attempts carry `error.type` and retries are derivable as the rate of datapoints where `error.type` is set. Redis latency is a property of the connection rather than the topic, so it is deliberately not attributed per topic.

Work is serialized per partition key, so a growing `n_eda.scheduler.wait.duration` alongside a low `n_eda.scheduler.partitions.blocked` means head-of-line blocking on a few hot keys rather than a shortage of processors.

### A note on cardinality

Event names appear on counters but never on histograms, and no synchronous instrument carries a partition id. This is deliberate: a bucketed histogram multiplies every attribute by its bucket count, and per-event-type latency is what the `event.<Name> process` span already gives you. Per-partition throughput is fully served by `n_eda.partition.write_index` / `read_index`, which come straight from Redis and survive restarts and replicas.

If you need to reshape any of this, use SDK Views scoped to `meterName: "n-eda"` rather than asking n-eda for a knob.

### Deprecated partition metrics log

Before OpenTelemetry metrics existed, the framework logged a JSON blob of per-partition state once a minute. It is still emitted, now tagged with `"$logType": "n-eda-partition-metrics"`, and **will be removed in v8**. Its `productionRate` and `consumptionRate` fields have already been removed: they were un-normalized deltas over a variable, unknowable interval and were never a rate in any dimension. Use `n_eda.partition.*` instead.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.


## Support
For support, please open an issue in the [GitHub repository](https://github.com/nivinjoseph/n-eda/issues).
