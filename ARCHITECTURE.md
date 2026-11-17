# n-eda Architecture

How the runtime actually works. For the API, see [README.md](README.md); for the rules you must obey
when writing against it, see [llms.txt](llms.txt).

## It is not Redis Streams

Despite the vocabulary — topics, partitions, consumer groups, offsets — n-eda does not use Redis
Streams, `XADD`, `XREADGROUP`, or Redis consumer groups. It implements a log by hand out of four
primitives:

- `INCR` on a per-partition **write index** to allocate a slot
- `SETEX` of a **deflate-compressed JSON array** into that slot
- `MGET` of a window of slots by the consumer
- `PUBLISH`/`SUBSCRIBE` on a per-partition channel as a low-latency doorbell

Understanding that shape explains most of the system's behavior, including its sharpest edges.

## Redis keys

All partition-scoped keys share a Redis Cluster **hash tag** — the `{...}` prefix — so every key for a
given topic-partition lands in the same slot and multi-key reads are cluster-legal.

| Key | Type | TTL | Written by | Read by |
|---|---|---|---|---|
| `{n-eda-<topic>-<partition>}-write-index` | string (int) | **none** | producer (`INCR`) | consumer (`MGET`) |
| `{n-eda-<topic>-<partition>}-<N>` | binary blob | `topic.ttlMinutes * 60` | producer (`SETEX`) | consumer (`MGET`/`GET`) |
| `{n-eda-<topic>-<partition>}-<group>-read-index` | string (int) | **none** | consumer | consumer |
| `{n-eda-<topic>-<partition>}-<group>-tracked_keys` | list | **none** | consumer (`LPUSH`/`LTRIM`) | consumer (`LRANGE`) |
| `{n-eda-<topic>-<partition>}-changed` | pub/sub channel | n/a | producer (`PUBLISH`) | `Monitor`, on a duplicated connection |
| `n-eda-observable-<Type>.<id>.<Event>` | set | **none** | `subscribeToObservables` (`SADD`) | `publish` (`SCARD`, `SMEMBERS`) |

Members of the observable set are `` `${observerTypeName}.${observerId}` ``.

> **Only the payload keys expire.** The write index, read index, and tracked-keys lists are immortal by
> design. Run Redis with `maxmemory-policy noeviction` — if the write index is evicted it resets to `0`
> while the read index stays high, making `readIndex >= writeIndex` permanently true. Consumption then
> stops silently and forever, with no error anywhere.

> The observable set keys carry **no hash tag**, so under Redis Cluster they scatter across slots.

There is a second, internal key format — `` `${topic}+++${partition}` `` — that never touches Redis. It
is a `Map` key in the producer registry and the value of the OpenTelemetry
`messaging.destination.name` attribute. Easy to mistake for a Redis key when reading traces.

## Publishing

`RedisEventBus.publish(topic, ...events)` or `publish(...events)` — the leading topic is optional:

1. Guard: not disposed; a passed `topic` is a registered topic name and is not the distributed-observer
   topic.
2. Resolve each event's targets: the passed topic, if any, plus the topics its class declares with `@topic`
   (read from the class's decorator metadata), de-duplicated. **Every target of every event is validated
   here, before any write**: an event with no target at all, a declared topic that is not registered, or a
   declared topic that is the distributed-observer topic rejects the whole call.
3. Bucket the events by topic and partition. Targets registered with `.disable()` are skipped.
   - `NedaClearTrackedKeysEvent` is special-cased and **fanned out to every partition**.
   - An event whose `name` is not in `manager.eventMap` is **dropped** on a topic, unless that topic was
     `.forcePublish()`ed. The rule is applied per topic, to passed and declared topics alike.
   - Otherwise `partition = mapToPartition(topicName, event)`.
4. Decide whether the observer fan-out below will run. An event counts toward it when it was bucketed for
   at least one topic, or when every topic it was addressed to is `.disable()`d. If no event in the call
   counts, nothing was bucketed either, so **return early** — note this skips the fan-out. Otherwise the
   fan-out runs for every event in the call.
5. One `Producer.produce(...)` per topic-partition, all in parallel. **The writes are independent**: there
   is no transaction across topics, so one topic can be written while another fails, and `publish` then
   rejects. It waits for every one of these writes to finish first (`Promise.allSettled`), so a rejection
   never leaves a topic write still running, and it reports the first failure in bucket order. When a
   write fails, the fan-out in step 6 does not run, so observers are not notified even for events that
   reached some of their topics.
6. Distributed-observer fan-out, if enabled (see below) — once per call, however many topics an event
   was written to.

`Producer.produce`:

```typescript
const compressed = await this._compressEvents(serialized);          // deflateRaw(JSON.stringify(array))
const writeIndex = await Make.retryWithExponentialBackoff(() => this._incrementPartitionWriteIndex(), 5)();
await Make.retryWithExponentialBackoff(() => this._storeEvents(writeIndex, compressed), 5)();
```

```typescript
private async _storeEvents(writeIndex: number, eventData: Buffer): Promise<void>
{
    const key = `${this.id}-${writeIndex}`;

    await this._client
        .pipeline()
        .setex(key, this._ttlSeconds, eventData)
        .publish(`${this.id}-changed`, this.id)
        .exec();
}
```

**One write-index slot holds one entire `publish()` batch for that partition, not one event.** A single
`publish(topic, ...10_000 events)` writes at most `numPartitions` Redis keys per target topic. This is why the consumer's
`maxRead = 50` means 50 *batches*, not 50 events.

**The `INCR` and the `SETEX` are two separate round-trips**, each independently retried. A consumer can
observe an allocated index whose payload has not landed yet — which is exactly what the consumer's
200-attempt read-retry loop exists to absorb.

## The consume loop

`Consumer._beginConsume`, per (topic, partition, consumer group):

1. `MGET` the write index and this group's read index together (same hash tag, so one round-trip).
2. Report lag to the `Broker` at most once per half metrics interval (30 s by default) — but only
   between batches, so a loop blocked in the handler retry ladder pauses reporting. The
   `MetricsReporter` logs those figures one flat line per partition — see
   [docs/observability.md](docs/observability.md).
3. If `readIndex >= writeIndex`, sleep a jittered `randomInt(2500, 5000)` ms on a cancellable delay and
   loop. The `Monitor`, subscribed to the `-changed` channel, cancels that delay the instant a producer
   publishes — so steady-state latency is sub-millisecond and the 2.5–5 s figure is only a fallback.
4. Otherwise compute the read window:

```typescript
const maxRead = 50;
const depth = writeIndex - readIndex;
const lowerBoundReadIndex = readIndex + 1;
let upperBoundReadIndex = writeIndex;
if (depth > maxRead)
{
    upperBoundReadIndex = readIndex + maxRead;

    if (depth > depthWarningThreshold) // 500
        await this._logger.logWarning(
            `Event queue depth for ${this.id} (consumer ${this._manager.consumerName} [${this._manager.consumerGroupId}]) is ${depth}.`);
}
```

5. One `MGET` for the whole window.
6. **Flush mode** (`Topic.flushConsume()`): advance the read index, `UNLINK` the keys, loop. No handler runs.
7. For each slot with a null value, retry `GET` up to **200 attempts** (100 ms for the first 50, then
   250 ms) — worst case ≈ 42 s for a single missing slot. On give-up: log, advance the read index by
   one, continue.
8. `inflateRaw` → `JSON.parse` → `Deserializer.deserialize` each event.
9. Skip any event id already in the tracked-keys set. If the id has been dispatched and is still running
   — a second copy in the same window, or this window being read again after an error — wait on that
   dispatch instead of starting another.
10. Resolve the handler registration. For the distributed-observer wrapper this means rebuilding the
    observation key from the wrapper's `observerTypeName` plus the inner event's `refType` and `name`.
    **If no registration matches, the event is marked processed and skipped** — this is deliberate, so a
    rolling deployment where one replica does not yet know an event type does not stall.
11. Route every event in the batch **concurrently**, then `await Promise.all(...)`.
12. Write any tracked ids not yet saved, trim the list, advance the read index to the window's upper
    bound, and — if `cleanUpKeys()` was configured — `UNLINK` the payload keys.

Tracked ids do not wait for step 12. Each id is written to the Redis list as its event finishes, by a
single writer per consumer: the first finished id starts an `LPUSH`, and ids that finish while it is in
flight go out together in the next one. At a low event rate that is one write per event; under load the
writes batch themselves.

Any throw in the loop body logs, sleeps 5 s, and retries **without advancing the read index**. Events
dispatched before the throw keep running, and the re-read waits on them (step 9). A
`NedaClearTrackedKeysEvent` is applied once while its window is being read, so a re-read skips it instead
of wiping the ids of events that finished after it. The consumer forgets that when the window completes,
and whenever it finds the read index somewhere other than where it left it, so a clear replayed after a
read-index rewind is applied again. While a clear is being applied, the ids of events that finish are held
back and tracked once it is done, so those events survive it.

When the loop exits — it returns as soon as it notices disposal, which can be partway through a window —
the consumer waits for every event it dispatched to settle and writes their ids before `dispose()`
resolves.

## Dispatch: route → schedule → process

`Broker.route` hands the work item to `OptimizedScheduler.scheduleWork`, which returns a `Deferred`.

The scheduler keeps one queue per partition key and a `Set` of partition keys currently in flight:

```typescript
private readonly _processing = new Set<string>();
```

A partition key is admitted only when it is not already in that set. **This is where ordering comes
from**: at most one work item per partition key executes at any moment, process-wide. Different
partition keys run concurrently, bounded by the number of `Processor` instances — which equals the
number of partitions this process owns for the topic.

`DefaultProcessor.processEvent` is where DI happens:

```typescript
const scope = this.manager.serviceLocator.createScope();
(<any>event).$scope = scope;

this._onEventReceived(scope, workItem.topic, event);        // RedisEventSubMgr sets EdaContext.topic

const handler = scope.resolve(workItem.eventRegistration.eventHandlerTypeName);
try { await handler.handle(event, observerId); }
finally { await scope.dispose(); }
```

One child DI scope per event delivery, disposed in `finally`. The handler is resolved **by its class
name**, which is why handler class names must be globally unique.

> `$scope` is stapled onto the event object and the scope is disposed when `handle()` returns. Holding a
> reference to the event past `handle()` gives you a disposed container.

## Delivery guarantees and failure modes

**At-least-once**, deduped best-effort.

The dedupe window is the tracked-keys list: last **1000 event ids** per (topic, partition, consumer
group), trimmed from 3000 down to 1000 whenever it grows past the ceiling. Anything older than that
window will be re-delivered if the read index ever rewinds. **Handlers must be idempotent.**

The dedupe compares event `id`s and nothing else, and the publisher chooses them. A second publish of the
same logical event is suppressed only if it carries the same `id` and the same partition key as the first
— so ids must be **deterministic**: the same on every retry, and derived from the triggering event's id
when an event is published from a handler. An id generated afresh on each attempt (a timestamp, a new
UUID per `publish` call) makes every retry look like a new event. The set also records ids that were
*seen*, not ids that succeeded: an event dropped after retry exhaustion is tracked, so republishing it
under the same id within the window is suppressed too.

Handler failures retry inside the processor:

```typescript
const maxProcessAttempts = 10;
const seconds = (5 + numProcessAttempts) * numProcessAttempts;   // [6, 14, 24, 36, 50, 66, 84, 104, 126]
```

10 attempts, 9 sleeps, **510 seconds ≈ 8 min 30 s** total.

| Scenario | Outcome |
|---|---|
| Handler throws once | Retried after 6 s, same processor, same event object. |
| Handler always throws | 10 attempts over ~8.5 min, then logged and **dropped**. No dead-letter queue. |
| Does a poison event block the partition? | **Yes, for ~8.5 min.** The consumer awaits the whole batch before advancing the read index, and the partition key stays locked in `_processing` throughout. Not forever, but long. |
| Crash mid-batch | The read index never advanced, so the batch replays. Events whose ids had reached Redis are suppressed. Ids are written as events finish, so what runs again is whatever was in flight, plus anything that finished within the last Redis round trip. |
| Broker disposed mid-flight | `ObjectDisposedException` → the event is deliberately **not** tracked, so it replays on restart. This is the graceful-shutdown path. Events that did finish are tracked, and their ids are saved before `dispose()` resolves. |
| `partitionKey` getter throws on the consuming side | The consumer reads `event.partitionKey` when it creates the receive span, before it hands the event to the broker. The dispatch rejects and the window fails: it is logged and retried every 5 s without advancing the read index, so the partition is stalled until the event can be dispatched. The process is not brought down. |
| Custom partition key mapper throws on the consuming side | A different path. The function given to `usePartitionKeyMapper` is called inside the dispatch's own error handling, so its error is recorded on the receive span and nowhere else: nothing is logged, and the event is marked processed and skipped. |

Six paths degrade to **at-most-once** — the event is skipped and the read index advances:

1. Retry exhaustion (10 failed attempts).
2. No handler registration for the event name (rolling deploy).
3. `Topic.flushConsume()`.
4. Read-retry exhaustion (200 attempts, payload never appeared).
5. TTL expiry before the consumer got there.
6. A custom partition key mapper that throws on the consuming side (silent: see the table above).

> **A consumer group offline longer than the topic TTL crawls rather than skips.** Every expired slot
> costs the full 200-attempt ladder — roughly 42 seconds — before the consumer gives up and advances a
> single index. A few thousand expired slots is indistinguishable from a hang.

## Partitioning and scaling

```typescript
public mapToPartition(topic: string, event: EdaEvent): number
{
    const partitionKey = this._partitionKeyMapper(event).trim();
    return MurmurHash.x86.hash32(partitionKey) % this._topicMap.get(topic)!.numPartitions;
}
```

MurmurHash3 x86 32-bit, seed 0, modulo `numPartitions`. No consistent hashing, no virtual nodes —
**changing `numPartitions` reshuffles every key**, breaks per-key ordering across the change, and
strands in-flight events in partitions no one reads.

Consumer assignment is **static and manual**. `RedisEventSubMgr.consume()` creates one `Consumer` and
one `Processor` per partition — every partition, unless `configurePartitionAffinity` narrows the range.
There is no group coordination, ownership lease, heartbeat, or rebalancing.

Consequences:

- Concurrency per process = partitions owned, per topic.
- Two replicas in the same consumer group without disjoint affinity **both** read the same window and
  **both** dispatch. Their tracked-key sets are loaded once at boot and never reconciled, so this
  produces genuine duplicate processing.
- Scaling out means editing configuration:

```typescript
new Topic("orders", Duration.fromHours(4), 100).subscribe().configurePartitionAffinity("0-49");   // replica A
new Topic("orders", Duration.fromHours(4), 100).subscribe().configurePartitionAffinity("50-99");  // replica B
```

> The partition key is computed twice and inconsistently: `mapToPartition` trims it for Redis routing,
> while the consumer uses the untrimmed value as the scheduler's ordering key. A mapper that returns
> padded strings yields two different keys.

## Distributed observer

A second routing layer, orthogonal to topics: it delivers events from **one specific instance** of a
remote entity to the subscribers watching that instance.

**Subscribe** (observer side) — validates that a local handler exists for the observation key
`` `.${observer}.${observable}.${event}` ``, then `SADD`s `` `${observerType}.${observerId}` `` into
`n-eda-observable-<ObservableType>.<observableId>.<ObservableEventType>`.

**Fan-out** (observable side) — on every `publish()`, for each event:

```typescript
const observableKey = this._generateObservableKey({
    observableType: event.refType, observableId: event.refId, observableEventType: event.name });

const hasSubs = await this._checkForSubscribers(observableKey);        // SCARD
if (hasSubs)
{
    const subs = await this._fetchSubscribers(observableKey);          // SMEMBERS
    // wrap in NedaDistributedObserverNotifyEvent, map to the observer topic's partition, produce
}
```

This is why `EdaEvent` requires `refId` and `refType` — they are the observable's identity. The wrapper
event uses `observerId` as its partition key, so all notifications for one observer are serialized.

**Delivery** — the consumer recognizes the wrapper by name, rebuilds the observation key, and
`DefaultProcessor` unwraps the inner event before calling `handle(observedEvent, observerId)`.

Two costs worth knowing: the fan-out is `SCARD` + `SMEMBERS` **per event, sequentially awaited**, so
publishing N events adds up to 2N serial round-trips; and the early return in step 4 of publishing means
a pure-publisher service never fans out at all. See [docs/known-issues.md](docs/known-issues.md).

## OpenTelemetry

Tracer name is always `"n-eda"`. Three spans per event, chained producer → receive → process. W3C
context travels in a `$traceData` property injected into the serialized event body by the producer and
extracted by the consumer.

| Span | Name | Kind |
|---|---|---|
| publish | `event.<EventName> publish` | `PRODUCER` |
| receive | `event.<EventName> receive` | `INTERNAL` |
| process | `event.<EventName> process` | `CONSUMER` |

All three carry `messaging.system` = `"n-eda"`, `messaging.operation.type`, `messaging.destination.name`
= `` `${topic}+++${partition}` ``, `messaging.destination.temporary` = `false`,
`messaging.message.id` = `event.id`, and `messaging.message.conversation_id` = `event.partitionKey`.

The **receive** span covers the scheduler queue wait *and* the entire retry ladder, so a poison event
produces an ~8.5-minute span.

> On retry and on exhaustion, n-eda writes the **full serialized event payload** into span events, span
> status messages, and log lines. Events carrying personal data will leak it into telemetry.

## Tuning constants

All hardcoded; none are configurable at runtime.

| Value | Location | Meaning |
|---|---|---|
| `"n-eda"` | `consumer.ts`, `producer.ts` | Redis key prefix, tracer name, `messaging.system` |
| `maxRead = 50` | `consumer.ts` | max write-index slots (batches) per poll |
| `depthWarningThreshold = 500` | `consumer.ts` | per-read backlog warning; decoupled from `maxRead` so routine catch-up stays quiet |
| `maxReadAttempts = 200` @ 100/250 ms | `consumer.ts` | payload-not-yet-written retry; ≈42 s worst case per slot |
| `randomInt(2500, 5000)` ms | `consumer.ts` | idle poll jitter, cancelled by the pub/sub doorbell |
| `Delay.seconds(5)` | `consumer.ts` | backoff after an unexpected consume-loop error |
| `_maxTrackedSize = 3000` / `_keepTrackedSize = 1000` | `consumer.ts` | dedupe window; `LTRIM 0 999` |
| `maxProcessAttempts = 10`, `(5+n)*n` s | `processor.ts` | handler retry ladder, 510 s total |
| `retryWithExponentialBackoff(..., 5)` | `producer.ts` | 6 attempts each for `INCR` and `SETEX` |
| `Duration.fromHours(1)` | `optimized-scheduler.ts` | empty-queue GC sweep |
| `Duration.fromMinutes(1)` default | `metrics-reporter.ts` | metrics log cadence (opt-in); enable and override via `enableMetrics(interval?)` |
| half the metrics interval | `consumer.ts` | lag report cadence, derived so no logged line is more than one report stale |
| `maxAcceptableLag = 1000` | `metrics-reporter.ts` | per-tick lag warning threshold |
| `connectionPoolSize` default `50` | `grpc-client-factory.ts` | round-robin gRPC client pool |
| `AbortSignal.timeout(60000)` | `rpc-proxy-processor.ts` | HTTP RPC timeout (gRPC has **no** deadline) |
| 2 s dev / 10 s otherwise | `redis-event-bus.ts` | event bus dispose drain |
| 2 s dev / 15 s otherwise | `rpc-server.ts`, `grpc-server.ts` | server connection drain |

## Connections and operations

- **One shared `ioredis` client** (`"EdaRedisClient"`) serves every producer and consumer. The `Monitor`
  calls `client.duplicate()` for its pub/sub subscriber, because subscribe mode monopolizes a
  connection. Size your Redis connection limits with partition count in mind.
- **`RedisEventBus.dispose()` does not close the Redis client** — it drains, then flips a flag.
  Connection lifecycle belongs to your app; register a `Disposable` alongside the client.
- **Redis Cluster** works for the topic-partition keys thanks to hash tags; the observable set keys are
  unhashed and scatter.
- **`cleanUpKeys()` deletes payloads immediately after this group's read index advances.** With a second
  consumer group on the same topic, it deletes data that group has not read yet.
