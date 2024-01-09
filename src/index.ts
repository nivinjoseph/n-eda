import { EdaEvent, EdaEventClass } from "./eda-event.js";
import { EdaEventHandler, EventHandlerClass } from "./eda-event-handler.js";
import { event, EventHandlerEventDecorator } from "./event.js";
import { EventRegistration } from "./event-registration.js";
import { EventBus } from "./event-bus.js";
import { EventSubMgr } from "./event-sub-mgr.js";
import { EdaManager } from "./eda-manager.js";
import { Topic } from "./topic.js";
// import { InMemoryEventBus } from "./in-memory-implementation/in-memory-event-bus.js";
// import { InMemoryEventSubMgr } from "./in-memory-implementation/in-memory-event-sub-mgr.js";
import { RedisEventBus } from "./redis-implementation/redis-event-bus.js";
import { RedisEventSubMgr } from "./redis-implementation/redis-event-sub-mgr.js";
import { AwsLambdaEventHandler } from "./redis-implementation/aws-lambda-event-handler.js";
import { LambdaDetails } from "./lambda-details.js";
import { ApplicationScript } from "./redis-implementation/application-script.js";
import { RpcDetails } from "./rpc-details.js";
import { RpcEventHandler } from "./redis-implementation/rpc-event-handler.js";
import { RpcServer } from "./redis-implementation/rpc-server.js";
import { GrpcDetails } from "./grpc-details.js";
import { GrpcEventHandler } from "./redis-implementation/grpc-event-handler.js";
import { GrpcServer } from "./redis-implementation/grpc-server.js";
import { NedaClearTrackedKeysEvent } from "./redis-implementation/neda-clear-tracked-keys-event.js";
import { observable, ObserverEventHandlerObservedEventDecorator, observedEvent, ObserverEventHandlerObservableDecorator, observer, ObserverEventHandlerObserverDecorator } from "./observed-event.js";
import { ObserverEdaEventHandler, ObserverEdaEventHandlerClass } from "./observer-eda-event-handler.js";

//@ts-expect-error polyfill to use metadata object
Symbol.metadata ??= Symbol("Symbol.metadata");


export
{
    EdaEvent, EdaEventClass, EdaEventHandler, EventHandlerClass,
    event, EventHandlerEventDecorator,
    Topic, EventRegistration, EventBus, EventSubMgr, EdaManager,

    // InMemoryEventBus, InMemoryEventSubMgr,

    RedisEventBus, RedisEventSubMgr,

    LambdaDetails, AwsLambdaEventHandler,

    ApplicationScript,

    RpcDetails, RpcEventHandler, RpcServer,

    GrpcDetails, GrpcEventHandler, GrpcServer,

    NedaClearTrackedKeysEvent,

    observedEvent, ObserverEventHandlerObservedEventDecorator,
    observable, ObserverEventHandlerObservableDecorator,
    observer, ObserverEventHandlerObserverDecorator,

    ObserverEdaEventHandler, ObserverEdaEventHandlerClass
};