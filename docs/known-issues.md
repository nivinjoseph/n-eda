# Known Issues

Defects found while documenting n-eda 7.0.3. **None of these have been fixed** — the docs describe
current behavior, and this file records what is broken so nobody rediscovers it the hard way.

Ordered roughly by impact.

---

## 1. Distributed observer is broken under all proxy consumers

**Severity: high — silent data loss.**

All three out-of-process handlers look up observer registrations by the bare event name:

```typescript
// aws-lambda-event-handler.ts:90, rpc-event-handler.ts:88, grpc-event-handler.ts:87
const eventRegistration = isObservedEvent
    ? this._manager!.observerEventMap.get(event.name)
    : this._manager!.eventMap.get(event.name);
```

But `observerEventMap` is keyed by the **observation key** — `` `.${observer}.${observable}.${event}` ``
(`eda-manager.ts:192`, `event-registration.ts:125`). The lookup is therefore always `undefined`, the
handler returns without dispatching, and the event is marked processed.

The correct pattern is in the in-process consumer, `consumer.ts:261-266`:

```typescript
const observationKey = EventRegistration.generateObservationKey(
    distributedObserverEvent.observerTypeName,
    distributedObserverEvent.observedEvent.refType,
    distributedObserverEvent.observedEvent.name);
eventRegistration = this._manager.observerEventMap.get(observationKey);
```

**Impact:** distributed observer combined with Lambda/RPC/gRPC proxying drops every observed event
silently. **Workaround:** use the in-process Redis consumer for observer handlers.

---

## 2. Observer fan-out is skipped for pure-publisher services

**Severity: high — silent, and the failure looks like a configuration problem.**

`RedisEventBus.publish` returns early when partition bucketing produced nothing:

```typescript
// redis-event-bus.ts:116-117
if (partitionEvents.size === 0)
    return;      // never reaches the observer fan-out block at :128
```

Bucketing skips any event with no locally-registered handler (unless the topic is `.forcePublish()`ed).
So a service that only *emits* an event — the normal shape for an observable — never notifies its remote
observers.

**Workaround:** call `.forcePublish()` on the topic, or register a local handler for the event.

---

## 3. `EdaContext.topic` throws under proxy consumers

**Severity: medium.**

`DefaultEdaContext.topic` is only populated by `RedisEventSubMgr.onEventReceived`
(`redis-event-sub-mgr.ts:156-164`). The `onEventReceived` overrides in `AwsLambdaEventHandler`,
`RpcEventHandler`, and `GrpcEventHandler` are empty no-ops, so the scoped context is never set and the
getter fails its `given(...).ensure(t => t._topic != null, "topic not set")`.

**Impact:** a handler that injects `"EdaContext"` works in-process and throws under any proxy.

---

## 4. `bootstrap()` has no gRPC mutual-exclusion guard

**Severity: medium — misconfiguration is accepted silently.**

`eda-manager.ts:364-374` cross-checks event subscriber vs Lambda consumer, event subscriber vs RPC
consumer, and Lambda vs RPC. There is no equivalent check involving `_isGrpcConsumer`, so a manager can
be configured as both an event subscriber and a gRPC consumer and will bootstrap happily.

---

## 5. `package.json` declares the wrong license

**Severity: low, but public-facing.**

- `LICENSE` — MIT, "Copyright (c) 2019 Nivin Joseph"
- `README.md` — MIT
- `package.json` — `"license": "ISC"`

npm advertises ISC. Two of the three sources agree on MIT; `package.json` is the outlier.

---

## 6. `mapToPartition` is case-sensitive but duplicate detection is not

**Severity: low.**

`registerTopics` rejects duplicates case-insensitively (`topic.name.toLowerCase()`), but `_topicMap` is
keyed by the exact name (`eda-manager.ts:380`). A topic registered as `"foo"` cannot be resolved by
`mapToPartition("Foo", ...)` — it fails an unnamed `.ensure(...)` with a generic message.

---

## 7. `dispose()` disposes a container it does not own

**Severity: low, but surprising.**

`EdaManager` tracks `_ownsContainer` and correctly skips `container.bootstrap()` for an externally
supplied container — but `dispose()` (`eda-manager.ts:447-459`) disposes it unconditionally. Sharing a
container between `EdaManager` and the rest of an app means disposing the manager takes the app's
container with it.

---

## 8. `ObservableWatch` accepts strings it cannot handle

**Severity: low — type says yes, runtime says no.**

`ObservableWatch.observableType` and `observableEventType` are typed `Function | string`.
`_generateObservableKey` handles both, but `subscribeToObservables` (`redis-event-bus.ts:231-232`) calls
`getTypeName()` unconditionally. For a string that returns `"String"`, producing the observation key
`.Observer.String.String`, which never matches and always throws "No handler registered".

**Workaround:** pass class references only.

---

## 9. `AwsLambdaProxyProcessor` throws a `TypeError` on an empty payload

**Severity: low.**

`aws-lambda-proxy-processor.ts:35-44` sets `result = null` when `response.Payload` is falsy, then reads
`result.eventName` unconditionally. An empty Lambda response yields a `TypeError` instead of a useful
diagnostic.

---

## 10. Inconsistent failure contract across proxy handlers

**Severity: low — a trap for anyone implementing a custom endpoint.**

- `AwsLambdaEventHandler.process` and `RpcEventHandler.process` **return** `{ statusCode: 500, error }`.
- `GrpcEventHandler.process` **throws**.

`RpcEventHandler` also returns HTTP 200 on failure with the error in the body
(`rpc-event-handler.ts:56-61`), so `RpcProxyProcessor` detects failure only by echo-checking
`body.eventName` and `body.eventId`. A custom RPC server that does not echo both fields exactly burns
all 10 retries on every event.

---

## 11. `GrpcDetails.isSecure` is accepted and ignored

**Severity: medium as a security expectation gap.**

The TLS branch is commented out. Both transports use insecure credentials
(`Grpc.credentials.createInsecure()` / `Grpc.ServerCredentials.createInsecure()`), and HTTP RPC is plain
`http://` with no authentication on `/process`. Full event payloads cross the wire unencrypted.
Passing `isSecure: true` changes nothing.

---

## 12. `.proto` files resolve from `src/` even when running from `dist/`

**Severity: medium — a packaging landmine.**

```typescript
// grpc-server.ts:188-193, grpc-client-factory.ts:44-49
const basePath = dirname.endsWith(`dist${Path.sep}redis-implementation`)
    ? Path.resolve(dirname, "..", "..", "src", "redis-implementation")
    : dirname;
```

`dist/redis-implementation/` contains no `.proto` files, and `package.json` has no `files` field — so
gRPC works only because the published tarball happens to ship `src/`. Any consumer that prunes `src/`
breaks gRPC at runtime. The `endsWith` check is also brittle for non-`dist` layouts.

---

## 13. `yarn test` cannot fail

**Severity: low, CI-relevant.**

```json
"test": "yarn setup-redis-server && yarn ts-build && node --test --enable-source-maps ./test/**/*.test.js || true && yarn teardown-redis-server"
```

The `|| true` guarantees a zero exit code so teardown always runs — but it also means a failing suite
looks green. Read the output, not the exit status.

---

## 14. Dead code and stale references

**Severity: cosmetic, but misleading to readers.**

- `src/in-memory-implementation/*` — both files commented out top to bottom; exports commented out of
  `src/index.ts`. The old README advertised `InMemoryEventBus` as "the default".
- `src/event-handler-tracer.ts` — entirely comments. `registerConsumerTracer` is commented out of
  `EdaManager`, and `test/utils/eda-test-utils.ts` references a `registerEventHandlerTracer` that never
  existed under that name.
- `src/redis-implementation/consumer-profiler.ts`, `profiling-consumer.ts` — unwired; `enableMetrics()`
  is commented out.
- `src/redis-implementation/default-scheduler.ts` — `@deprecated`; `Broker` always uses `OptimizedScheduler`.
- Wildcard event-name matching was removed but its parsing remains commented in `event-registration.ts:103-116`.
- `src/discovery/event-handler-discovery.ts` carried a doc comment referring to a non-existent
  `EdaManagerOptions.eventHandlers`. **Fixed in this documentation pass** — it now describes
  `registerEventHandlers(...)`.

---

## Notes for whoever fixes these

Items 1, 3, and 4 are small, well-understood changes with an obvious correct implementation, but each
alters runtime behavior and needs its own test. Item 5 is a one-word edit. Item 12 is a packaging
decision (add a `files` field and copy `.proto` into `dist/`) rather than a code fix.
