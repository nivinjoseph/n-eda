import { given } from "@nivinjoseph/n-defensive";
import { Container } from "@nivinjoseph/n-ject";
import { ApplicationException, ObjectDisposedException } from "@nivinjoseph/n-exception";
import { EventRegistration } from "./event-registration.js";
import { Topic } from "./topic.js";
import MurmurHash from "murmurhash3js";
import { AwsLambdaEventHandler } from "./redis-implementation/aws-lambda-event-handler.js";
import { RpcEventHandler } from "./redis-implementation/rpc-event-handler.js";
import { GrpcEventHandler } from "./redis-implementation/grpc-event-handler.js";
// import { ConsumerTracer } from "./event-handler-tracer";
// public
export class EdaManager {
    static get eventBusKey() { return "EventBus"; }
    static get eventSubMgrKey() { return "EventSubMgr"; }
    get containerRegistry() { return this._container; }
    get serviceLocator() { return this._container; }
    get topics() { return this._topics; }
    get distributedObserverTopic() { return this._distributedObserverTopic; }
    get eventMap() { return this._eventMap; }
    get observerEventMap() { return this._observerEventMap; }
    get consumerName() { return this._consumerName; }
    get consumerGroupId() { return this._consumerGroupId; }
    get cleanKeys() { return this._cleanKeys; }
    // public get consumerTracer(): ConsumerTracer | null { return this._consumerTracer; }
    get awsLambdaDetails() { return this._awsLambdaDetails; }
    get awsLambdaProxyEnabled() { return this._awsLambdaDetails != null; }
    get isAwsLambdaConsumer() { return this._isAwsLambdaConsumer; }
    get rpcDetails() { return this._rpcDetails; }
    get rpcProxyEnabled() { return this._rpcDetails != null; }
    get isRpcConsumer() { return this._isRpcConsumer; }
    get grpcDetails() { return this._grpcDetails; }
    get grpcProxyEnabled() { return this._grpcDetails != null; }
    get isGrpcConsumer() { return this._isGrpcConsumer; }
    get partitionKeyMapper() { return this._partitionKeyMapper; }
    // public get metricsEnabled(): boolean { return this._metricsEnabled; }
    constructor(container) {
        // private readonly _wildKeys: Array<string>;
        // private _metricsEnabled = false;
        this._partitionKeyMapper = null;
        this._eventBusRegistered = false;
        this._eventSubMgrRegistered = false;
        this._evtSubMgr = null;
        this._consumerName = "UNNAMED";
        this._consumerGroupId = null;
        this._cleanKeys = false;
        this._distributedObserverTopic = null;
        // private _consumerTracer: ConsumerTracer | null = null;
        this._awsLambdaDetails = null;
        this._isAwsLambdaConsumer = false;
        this._awsLambdaEventHandler = null;
        this._rpcDetails = null;
        this._isRpcConsumer = false;
        this._rpcEventHandler = null;
        this._grpcDetails = null;
        this._isGrpcConsumer = false;
        this._grpcEventHandler = null;
        this._isDisposed = false;
        this._disposePromise = null;
        this._isBootstrapped = false;
        given(container, "container").ensureIsObject().ensureIsType(Container);
        if (container == null) {
            this._container = new Container();
            this._ownsContainer = true;
        }
        else {
            this._container = container;
            this._ownsContainer = false;
        }
        this._topics = new Array();
        this._topicMap = new Map();
        this._eventMap = new Map();
        this._observerEventMap = new Map();
        // this._wildKeys = new Array<string>();
    }
    useInstaller(installer) {
        given(installer, "installer").ensureHasValue().ensureIsObject();
        given(this, "this").ensure(t => !t._isBootstrapped, "invoking method after bootstrap");
        this._container.install(installer);
        return this;
    }
    useConsumerName(name) {
        given(name, "name").ensureHasValue().ensureIsString();
        given(this, "this").ensure(t => !t._isBootstrapped, "invoking method after bootstrap");
        this._consumerName = name;
        return this;
    }
    registerTopics(...topics) {
        given(topics, "topics").ensureHasValue().ensureIsArray();
        given(this, "this").ensure(t => !t._isBootstrapped, "invoking method after bootstrap");
        for (const topic of topics) {
            const name = topic.name.toLowerCase();
            if (this._topics.some(t => t.name.toLowerCase() === name))
                throw new ApplicationException(`Multiple topics with the name '${name}' detected.`);
            this._topics.push(topic);
        }
        return this;
    }
    // public enableMetrics(): this
    // {
    //     given(this, "this").ensure(t => !t._isBootstrapped, "invoking method after bootstrap");
    //     this._metricsEnabled = true;
    //     return this;
    // }
    usePartitionKeyMapper(func) {
        given(func, "func").ensureHasValue().ensureIsFunction();
        given(this, "this")
            .ensure(t => !t._partitionKeyMapper, "partition key mapper already set")
            .ensure(t => !t._isBootstrapped, "invoking method after bootstrap");
        this._partitionKeyMapper = func;
        return this;
    }
    registerEventHandlers(...eventHandlerClasses) {
        given(eventHandlerClasses, "eventHandlerClasses").ensureHasValue().ensureIsArray();
        given(this, "this").ensure(t => !t._isBootstrapped, "invoking method after bootstrap");
        for (const eventHandler of eventHandlerClasses) {
            const eventRegistration = new EventRegistration(eventHandler);
            if (eventRegistration.isObservedEvent) {
                // observable, observedEvent, observer, observedEventHandler
                // Need to enforce: that for one observable.observedEvent.observer combination, there is on only one handler
                if (this._observerEventMap.has(eventRegistration.observationKey))
                    throw new ApplicationException(`Multiple observer event handlers detected for observer key '${eventRegistration.observationKey}'.`);
                this._observerEventMap.set(eventRegistration.observationKey, eventRegistration);
            }
            else {
                // this enforces that you cannot have 2 handler classes for the same event
                if (this._eventMap.has(eventRegistration.eventTypeName))
                    throw new ApplicationException(`Multiple event handlers detected for event '${eventRegistration.eventTypeName}'.`);
                this._eventMap.set(eventRegistration.eventTypeName, eventRegistration);
            }
            // this enforces that you cannot have 2 handler classes with the same name
            this._container.registerScoped(eventRegistration.eventHandlerTypeName, eventRegistration.eventHandlerType);
        }
        return this;
    }
    // public registerConsumerTracer(tracer: ConsumerTracer): this
    // {
    //     given(tracer, "tracer").ensureHasValue().ensureIsFunction();
    //     given(this, "this")
    //         .ensure(t => !t._isBootstrapped, "invoking method after bootstrap")
    //         .ensure(t => !t._consumerTracer, "consumer tracer already set");
    //     this._consumerTracer = tracer;
    //     return this;
    // }
    registerEventBus(eventBus) {
        given(eventBus, "eventBus").ensureHasValue();
        given(this, "this")
            .ensure(t => !t._isBootstrapped, "invoking method after bootstrap")
            .ensure(t => !t._eventBusRegistered, "event bus already registered");
        if (typeof eventBus === "function")
            this._container.registerSingleton(EdaManager.eventBusKey, eventBus);
        else
            this._container.registerInstance(EdaManager.eventBusKey, eventBus);
        this._eventBusRegistered = true;
        return this;
    }
    registerEventSubscriptionManager(eventSubMgr, consumerGroupId) {
        given(eventSubMgr, "eventSubMgr").ensureHasValue();
        given(consumerGroupId, "consumerGroupId").ensureHasValue().ensureIsString();
        given(this, "this")
            .ensure(t => !t._isBootstrapped, "invoking method after bootstrap")
            .ensure(t => !t._eventSubMgrRegistered, "event subscription manager already registered");
        if (typeof eventSubMgr === "function")
            this._container.registerSingleton(EdaManager.eventSubMgrKey, eventSubMgr);
        else
            this._container.registerInstance(EdaManager.eventSubMgrKey, eventSubMgr);
        this._consumerGroupId = consumerGroupId.trim();
        this._eventSubMgrRegistered = true;
        return this;
    }
    cleanUpKeys() {
        given(this, "this")
            .ensure(t => !t._isBootstrapped, "invoking method after bootstrap");
        this._cleanKeys = true;
        return this;
    }
    proxyToAwsLambda(lambdaDetails) {
        given(lambdaDetails, "lambdaDetails").ensureHasValue().ensureIsObject();
        given(this, "this")
            .ensure(t => !t._isBootstrapped, "invoking method after bootstrap");
        this._awsLambdaDetails = lambdaDetails;
        return this;
    }
    actAsAwsLambdaConsumer(handler) {
        given(handler, "handler").ensureHasValue().ensureIsObject().ensureIsInstanceOf(AwsLambdaEventHandler);
        given(this, "this")
            .ensure(t => !t._isBootstrapped, "invoking method after bootstrap");
        this._awsLambdaEventHandler = handler;
        this._isAwsLambdaConsumer = true;
        return this;
    }
    proxyToRpc(rpcDetails) {
        given(rpcDetails, "rpcDetails").ensureHasValue().ensureIsObject();
        given(this, "this")
            .ensure(t => !t._isBootstrapped, "invoking method after bootstrap");
        this._rpcDetails = rpcDetails;
        return this;
    }
    actAsRpcConsumer(handler) {
        given(handler, "handler").ensureHasValue().ensureIsObject().ensureIsInstanceOf(RpcEventHandler);
        given(this, "this")
            .ensure(t => !t._isBootstrapped, "invoking method after bootstrap");
        this._rpcEventHandler = handler;
        this._isRpcConsumer = true;
        return this;
    }
    proxyToGrpc(grpcDetails) {
        given(grpcDetails, "grpcDetails").ensureHasValue().ensureIsObject();
        given(this, "this")
            .ensure(t => !t._isBootstrapped, "invoking method after bootstrap");
        this._grpcDetails = grpcDetails;
        return this;
    }
    actAsGrpcConsumer(handler) {
        given(handler, "handler").ensureHasValue().ensureIsObject().ensureIsInstanceOf(GrpcEventHandler);
        given(this, "this")
            .ensure(t => !t._isBootstrapped, "invoking method after bootstrap");
        this._grpcEventHandler = handler;
        this._isGrpcConsumer = true;
        return this;
    }
    enableDistributedObserver(topic) {
        given(topic, "topic").ensureHasValue().ensureIsType(Topic);
        given(this, "this").ensure(t => !t._isBootstrapped, "invoking method after bootstrap");
        const name = topic.name.toLowerCase();
        if (this._topics.some(t => t.name.toLowerCase() === name))
            throw new ApplicationException(`Multiple topics with the name '${name}' detected when registering distributed observer topic.`);
        this._topics.push(topic);
        this._distributedObserverTopic = topic;
        return this;
    }
    bootstrap() {
        if (this._isDisposed)
            throw new ObjectDisposedException(this);
        given(this, "this")
            .ensure(t => !t._isBootstrapped, "bootstrapping more than once")
            .ensure(t => t._topics.length > 0, "no topics registered")
            // .ensure(t => !!t._partitionKeyMapper, "no partition key mapper set")
            .ensure(t => t._eventBusRegistered, "no event bus registered")
            .ensure(t => !(t._eventSubMgrRegistered && t._isAwsLambdaConsumer), "cannot be both event subscriber and lambda consumer")
            .ensure(t => !(t._eventSubMgrRegistered && t._isRpcConsumer), "cannot be both event subscriber and rpc consumer")
            .ensure(t => !(t._isAwsLambdaConsumer && t._isRpcConsumer), "cannot be both lambda consumer and rpc consumer");
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this._partitionKeyMapper == null)
            this._partitionKeyMapper = (edaEvent) => edaEvent.partitionKey;
        this._topics.map(t => this._topicMap.set(t.name, t));
        if (this._ownsContainer)
            this._container.bootstrap();
        this._container.resolve(EdaManager.eventBusKey).initialize(this);
        if (this._eventSubMgrRegistered)
            this._container.resolve(EdaManager.eventSubMgrKey).initialize(this);
        if (this._isAwsLambdaConsumer)
            this._awsLambdaEventHandler.initialize(this);
        if (this._isRpcConsumer)
            this._rpcEventHandler.initialize(this);
        if (this._isGrpcConsumer)
            this._grpcEventHandler.initialize(this);
        this._isBootstrapped = true;
    }
    async beginConsumption() {
        if (this._isDisposed)
            throw new ObjectDisposedException(this);
        given(this, "this")
            .ensure(t => t._isBootstrapped, "not bootstrapped")
            .ensure(t => t._eventSubMgrRegistered, "no EventSubMgr registered");
        this._evtSubMgr = this.serviceLocator.resolve(EdaManager.eventSubMgrKey);
        await this._evtSubMgr.consume();
    }
    mapToPartition(topic, event) {
        given(topic, "topic").ensureHasValue().ensureIsString()
            .ensure(t => this._topicMap.has(t));
        given(event, "event").ensureHasValue().ensureIsObject();
        if (this._isDisposed)
            throw new ObjectDisposedException(this);
        given(this, "this")
            .ensure(t => t._isBootstrapped, "not bootstrapped");
        const partitionKey = this._partitionKeyMapper(event).trim();
        return MurmurHash.x86.hash32(partitionKey) % this._topicMap.get(topic).numPartitions;
    }
    // public getEventRegistration(event: EdaEvent): EventRegistration | false
    // {
    //     let eventRegistration: EventRegistration | null = null;
    //     if (this._eventMap.has(event.name))
    //         eventRegistration = this._eventMap.get(event.name) as EventRegistration;
    //     else
    //     {
    //         const wildKey = this._wildKeys.find(t => event.name.startsWith(t));
    //         if (wildKey)
    //             eventRegistration = this._eventMap.get(wildKey) as EventRegistration;
    //     }
    //     return eventRegistration || false;
    // }
    dispose() {
        if (!this._isDisposed) {
            this._isDisposed = true;
            if (this._evtSubMgr != null)
                this._disposePromise = this._evtSubMgr.dispose().then(() => this._container.dispose());
            else
                this._disposePromise = this._container.dispose();
        }
        return this._disposePromise;
    }
}
//# sourceMappingURL=eda-manager.js.map