import { event } from "./event.js";
import { EventRegistration } from "./event-registration.js";
import { EdaManager } from "./eda-manager.js";
import { Topic } from "./topic.js";
// import { InMemoryEventBus } from "./in-memory-implementation/in-memory-event-bus.js";
// import { InMemoryEventSubMgr } from "./in-memory-implementation/in-memory-event-sub-mgr.js";
import { RedisEventBus } from "./redis-implementation/redis-event-bus.js";
import { RedisEventSubMgr } from "./redis-implementation/redis-event-sub-mgr.js";
import { AwsLambdaEventHandler } from "./redis-implementation/aws-lambda-event-handler.js";
import { RpcEventHandler } from "./redis-implementation/rpc-event-handler.js";
import { RpcServer } from "./redis-implementation/rpc-server.js";
import { GrpcEventHandler } from "./redis-implementation/grpc-event-handler.js";
import { GrpcServer } from "./redis-implementation/grpc-server.js";
import { NedaClearTrackedKeysEvent } from "./redis-implementation/neda-clear-tracked-keys-event.js";
import { observable, observedEvent, observer } from "./observed-event.js";
import { discoverEventHandlers } from "./discovery/event-handler-discovery.js";
// Polyfill for the standard-decorator metadata slot.
//
// n-eda's decorators (@event, @observedEvent, @observable, @observer) are TC39 stage-3 class decorators
// that write into `context.metadata`, and EventRegistration reads it back off the class via
// `HandlerClass[Symbol.metadata]`. Node does not define `Symbol.metadata` yet, so this line establishes it
// at package-load time.
//
// Consequence: importing this barrel is a PREREQUISITE for the decorators to work at all. A consumer that
// only deep-imports individual modules will see undefined metadata and every handler registration will fail.
//@ts-expect-error polyfill to use metadata object
Symbol.metadata ??= Symbol("Symbol.metadata");
export { event, Topic, EventRegistration, EdaManager, 
// InMemoryEventBus, InMemoryEventSubMgr,
RedisEventBus, RedisEventSubMgr, AwsLambdaEventHandler, RpcEventHandler, RpcServer, GrpcEventHandler, GrpcServer, NedaClearTrackedKeysEvent, observedEvent, observable, observer, discoverEventHandlers };
//# sourceMappingURL=index.js.map