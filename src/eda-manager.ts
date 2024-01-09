import { given } from "@nivinjoseph/n-defensive";
import { Container, Registry, ServiceLocator, ComponentInstaller } from "@nivinjoseph/n-ject";
import { ApplicationException, ObjectDisposedException } from "@nivinjoseph/n-exception";
import { EventBus } from "./event-bus.js";
import { EventSubMgr } from "./event-sub-mgr.js";
import { ClassDefinition, Disposable } from "@nivinjoseph/n-util";
import { EventRegistration } from "./event-registration.js";
import { Topic } from "./topic.js";
import { EdaEvent } from "./eda-event.js";
import MurmurHash from "murmurhash3js";
import { EdaEventHandler } from "./eda-event-handler.js";
import { AwsLambdaEventHandler } from "./redis-implementation/aws-lambda-event-handler.js";
import { LambdaDetails } from "./lambda-details.js";
import { RpcDetails } from "./rpc-details.js";
import { RpcEventHandler } from "./redis-implementation/rpc-event-handler.js";
import { GrpcEventHandler } from "./redis-implementation/grpc-event-handler.js";
import { GrpcDetails } from "./grpc-details.js";
import { ObserverEdaEventHandler } from "./observer-eda-event-handler.js";
// import { ConsumerTracer } from "./event-handler-tracer";

// public
export class EdaManager implements Disposable
{
    private readonly _container: Container;
    private readonly _ownsContainer: boolean;
    private readonly _topics: Array<Topic>;
    private readonly _topicMap: Map<string, Topic>;
    private readonly _eventMap: Map<string, EventRegistration>;
    private readonly _observerEventMap: Map<string, EventRegistration>;
    // private readonly _wildKeys: Array<string>;

    // private _metricsEnabled = false;
    private _partitionKeyMapper: (event: EdaEvent) => string = null as any;
    private _eventBusRegistered = false;
    private _eventSubMgrRegistered = false;
    private _evtSubMgr: EventSubMgr | null = null;
    private _consumerName = "UNNAMED";
    private _consumerGroupId: string | null = null;
    private _cleanKeys = false;

    private _distributedObserverTopic: Topic | null = null;

    // private _consumerTracer: ConsumerTracer | null = null;

    private _awsLambdaDetails: LambdaDetails | null = null;
    private _isAwsLambdaConsumer = false;
    private _awsLambdaEventHandler: AwsLambdaEventHandler | null = null;

    private _rpcDetails: RpcDetails | null = null;
    private _isRpcConsumer = false;
    private _rpcEventHandler: RpcEventHandler | null = null;

    private _grpcDetails: GrpcDetails | null = null;
    private _isGrpcConsumer = false;
    private _grpcEventHandler: GrpcEventHandler | null = null;


    private _isDisposed = false;
    private _disposePromise: Promise<void> | null = null;
    private _isBootstrapped = false;


    public static get eventBusKey(): string { return "EventBus"; }
    public static get eventSubMgrKey(): string { return "EventSubMgr"; }

    public get containerRegistry(): Registry { return this._container; }
    public get serviceLocator(): ServiceLocator { return this._container; }
    public get topics(): ReadonlyArray<Topic> { return this._topics; }
    public get distributedObserverTopic(): Topic | null { return this._distributedObserverTopic; }
    public get eventMap(): ReadonlyMap<string, EventRegistration> { return this._eventMap; }
    public get observerEventMap(): ReadonlyMap<string, EventRegistration> { return this._observerEventMap; }
    public get consumerName(): string { return this._consumerName; }
    public get consumerGroupId(): string | null { return this._consumerGroupId; }
    public get cleanKeys(): boolean { return this._cleanKeys; }

    // public get consumerTracer(): ConsumerTracer | null { return this._consumerTracer; }

    public get awsLambdaDetails(): LambdaDetails | null { return this._awsLambdaDetails; }
    public get awsLambdaProxyEnabled(): boolean { return this._awsLambdaDetails != null; }
    public get isAwsLambdaConsumer(): boolean { return this._isAwsLambdaConsumer; }

    public get rpcDetails(): RpcDetails | null { return this._rpcDetails; }
    public get rpcProxyEnabled(): boolean { return this._rpcDetails != null; }
    public get isRpcConsumer(): boolean { return this._isRpcConsumer; }

    public get grpcDetails(): GrpcDetails | null { return this._grpcDetails; }
    public get grpcProxyEnabled(): boolean { return this._grpcDetails != null; }
    public get isGrpcConsumer(): boolean { return this._isGrpcConsumer; }

    public get partitionKeyMapper(): (event: EdaEvent) => string { return this._partitionKeyMapper; }
    // public get metricsEnabled(): boolean { return this._metricsEnabled; }


    public constructor(container?: Container)
    {
        given(container as Container, "container").ensureIsObject().ensureIsType(Container);

        if (container == null)
        {
            this._container = new Container();
            this._ownsContainer = true;
        }
        else
        {
            this._container = container;
            this._ownsContainer = false;
        }

        this._topics = new Array<Topic>();
        this._topicMap = new Map<string, Topic>();
        this._eventMap = new Map<string, EventRegistration>();
        this._observerEventMap = new Map<string, EventRegistration>();
        // this._wildKeys = new Array<string>();
    }


    public useInstaller(installer: ComponentInstaller): this
    {
        given(installer, "installer").ensureHasValue().ensureIsObject();
        given(this, "this").ensure(t => !t._isBootstrapped, "invoking method after bootstrap");

        this._container.install(installer);
        return this;
    }

    public useConsumerName(name: string): this
    {
        given(name, "name").ensureHasValue().ensureIsString();
        given(this, "this").ensure(t => !t._isBootstrapped, "invoking method after bootstrap");

        this._consumerName = name;
        return this;
    }

    public registerTopics(...topics: Array<Topic>): this
    {
        given(topics, "topics").ensureHasValue().ensureIsArray();
        given(this, "this").ensure(t => !t._isBootstrapped, "invoking method after bootstrap");

        for (const topic of topics)
        {
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

    public usePartitionKeyMapper(func: (event: EdaEvent) => string): this
    {
        given(func, "func").ensureHasValue().ensureIsFunction();
        given(this, "this")
            .ensure(t => !t._partitionKeyMapper, "partition key mapper already set")
            .ensure(t => !t._isBootstrapped, "invoking method after bootstrap");

        this._partitionKeyMapper = func;

        return this;
    }

    public registerEventHandlers(...eventHandlerClasses: Array<ClassDefinition<EdaEventHandler<EdaEvent> | ObserverEdaEventHandler<EdaEvent>>>): this
    {
        given(eventHandlerClasses, "eventHandlerClasses").ensureHasValue().ensureIsArray();
        given(this, "this").ensure(t => !t._isBootstrapped, "invoking method after bootstrap");

        for (const eventHandler of eventHandlerClasses)
        {
            const eventRegistration = new EventRegistration(eventHandler);

            if (eventRegistration.isObservedEvent)
            {
                // observable, observedEvent, observer, observedEventHandler

                // Need to enforce: that for one observable.observedEvent.observer combination, there is on only one handler
                if (this._observerEventMap.has(eventRegistration.observationKey))
                    throw new ApplicationException(`Multiple observer event handlers detected for observer key '${eventRegistration.observationKey}'.`);

                this._observerEventMap.set(eventRegistration.observationKey, eventRegistration);
            }
            else
            {
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

    public registerEventBus(eventBus: EventBus | ClassDefinition<EventBus>): this
    {
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

    public registerEventSubscriptionManager(eventSubMgr: EventSubMgr | ClassDefinition<EventSubMgr>, consumerGroupId: string): this
    {
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

    public cleanUpKeys(): this
    {
        given(this, "this")
            .ensure(t => !t._isBootstrapped, "invoking method after bootstrap");

        this._cleanKeys = true;

        return this;
    }

    public proxyToAwsLambda(lambdaDetails: LambdaDetails): this
    {
        given(lambdaDetails, "lambdaDetails").ensureHasValue().ensureIsObject();

        given(this, "this")
            .ensure(t => !t._isBootstrapped, "invoking method after bootstrap");

        this._awsLambdaDetails = lambdaDetails;

        return this;
    }

    public actAsAwsLambdaConsumer(handler: AwsLambdaEventHandler): this
    {
        given(handler, "handler").ensureHasValue().ensureIsObject().ensureIsInstanceOf(AwsLambdaEventHandler);

        given(this, "this")
            .ensure(t => !t._isBootstrapped, "invoking method after bootstrap");

        this._awsLambdaEventHandler = handler;
        this._isAwsLambdaConsumer = true;

        return this;
    }

    public proxyToRpc(rpcDetails: RpcDetails): this
    {
        given(rpcDetails, "rpcDetails").ensureHasValue().ensureIsObject();

        given(this, "this")
            .ensure(t => !t._isBootstrapped, "invoking method after bootstrap");

        this._rpcDetails = rpcDetails;

        return this;
    }

    public actAsRpcConsumer(handler: RpcEventHandler): this
    {
        given(handler, "handler").ensureHasValue().ensureIsObject().ensureIsInstanceOf(RpcEventHandler);

        given(this, "this")
            .ensure(t => !t._isBootstrapped, "invoking method after bootstrap");

        this._rpcEventHandler = handler;
        this._isRpcConsumer = true;

        return this;
    }

    public proxyToGrpc(grpcDetails: GrpcDetails): this
    {
        given(grpcDetails, "grpcDetails").ensureHasValue().ensureIsObject();

        given(this, "this")
            .ensure(t => !t._isBootstrapped, "invoking method after bootstrap");

        this._grpcDetails = grpcDetails;

        return this;
    }

    public actAsGrpcConsumer(handler: GrpcEventHandler): this
    {
        given(handler, "handler").ensureHasValue().ensureIsObject().ensureIsInstanceOf(GrpcEventHandler);

        given(this, "this")
            .ensure(t => !t._isBootstrapped, "invoking method after bootstrap");

        this._grpcEventHandler = handler;
        this._isGrpcConsumer = true;

        return this;
    }

    public enableDistributedObserver(topic: Topic): this
    {
        given(topic, "topic").ensureHasValue().ensureIsType(Topic);
        given(this, "this").ensure(t => !t._isBootstrapped, "invoking method after bootstrap");

        const name = topic.name.toLowerCase();
        if (this._topics.some(t => t.name.toLowerCase() === name))
            throw new ApplicationException(`Multiple topics with the name '${name}' detected when registering distributed observer topic.`);

        this._topics.push(topic);
        this._distributedObserverTopic = topic;

        return this;
    }


    public bootstrap(): void
    {
        if (this._isDisposed)
            throw new ObjectDisposedException(this);

        given(this, "this")
            .ensure(t => !t._isBootstrapped, "bootstrapping more than once")
            .ensure(t => t._topics.length > 0, "no topics registered")
            // .ensure(t => !!t._partitionKeyMapper, "no partition key mapper set")
            .ensure(t => t._eventBusRegistered, "no event bus registered")
            .ensure(t => !(t._eventSubMgrRegistered && t._isAwsLambdaConsumer),
                "cannot be both event subscriber and lambda consumer")
            .ensure(t => !(t._eventSubMgrRegistered && t._isRpcConsumer),
                "cannot be both event subscriber and rpc consumer")
            .ensure(t => !(t._isAwsLambdaConsumer && t._isRpcConsumer),
                "cannot be both lambda consumer and rpc consumer");

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this._partitionKeyMapper == null)
            this._partitionKeyMapper = (edaEvent): string => edaEvent.partitionKey;

        this._topics.map(t => this._topicMap.set(t.name, t));

        if (this._ownsContainer)
            this._container.bootstrap();

        this._container.resolve<EventBus>(EdaManager.eventBusKey).initialize(this);

        if (this._eventSubMgrRegistered)
            this._container.resolve<EventSubMgr>(EdaManager.eventSubMgrKey).initialize(this);

        if (this._isAwsLambdaConsumer)
            this._awsLambdaEventHandler!.initialize(this);

        if (this._isRpcConsumer)
            this._rpcEventHandler!.initialize(this);

        if (this._isGrpcConsumer)
            this._grpcEventHandler!.initialize(this);

        this._isBootstrapped = true;
    }

    public async beginConsumption(): Promise<void>
    {
        if (this._isDisposed)
            throw new ObjectDisposedException(this);

        given(this, "this")
            .ensure(t => t._isBootstrapped, "not bootstrapped")
            .ensure(t => t._eventSubMgrRegistered, "no EventSubMgr registered");

        this._evtSubMgr = this.serviceLocator.resolve<EventSubMgr>(EdaManager.eventSubMgrKey);
        await this._evtSubMgr.consume();
    }

    public mapToPartition(topic: string, event: EdaEvent): number
    {
        given(topic, "topic").ensureHasValue().ensureIsString()
            .ensure(t => this._topicMap.has(t));
        given(event, "event").ensureHasValue().ensureIsObject();

        if (this._isDisposed)
            throw new ObjectDisposedException(this);

        given(this, "this")
            .ensure(t => t._isBootstrapped, "not bootstrapped");

        const partitionKey = this._partitionKeyMapper(event).trim();

        return MurmurHash.x86.hash32(partitionKey) % this._topicMap.get(topic)!.numPartitions;
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

    public dispose(): Promise<void>
    {
        if (!this._isDisposed)
        {
            this._isDisposed = true;

            if (this._evtSubMgr != null)
                this._disposePromise = this._evtSubMgr.dispose().then(() => this._container.dispose());
            else
                this._disposePromise = this._container.dispose();
        }
        return this._disposePromise!;
    }


    // private createEventMap(eventHandlerClasses: ReadonlyArray<Function>): Map<string, EventRegistration>
    // {
    //     given(eventHandlerClasses, "eventHandlerClasses").ensureHasValue().ensureIsArray();

    //     const eventRegistrations = eventHandlerClasses.map(t => new EventRegistration(t));
    //     const eventMap = new Map<string, EventRegistration>();

    //     eventRegistrations.forEach(t =>
    //     {
    //         if (eventMap.has(t.eventTypeName))
    //             throw new ApplicationException(`Multiple handlers detected for event '${t.eventTypeName}'.`);

    //         eventMap.set(t.eventTypeName, t);
    //     });

    //     const keys = [...eventMap.keys()];

    //     eventMap.forEach(t =>
    //     {
    //         if (t.isWild)
    //         {
    //             const conflicts = keys.where(u => u !== t.eventTypeName && u.startsWith(t.eventTypeName));
    //             if (conflicts.length > 0)
    //                 throw new ApplicationException(`Handler conflict detected between wildcard '${t.eventTypeName}' and events '${conflicts.join(",")}'.`);    
    //         }

    //         this._container.registerScoped(t.eventHandlerTypeName, t.eventHandlerType);
    //     });

    //     return eventMap;
    // }

    // private registerBusAndMgr(eventBus: EventBus | Function, eventSubMgr: EventSubMgr | Function): void
    // {
    //     given(eventBus, "eventBus").ensureHasValue().ensure(t => typeof t === "function" || typeof t === "object");
    //     given(eventSubMgr, "eventSubMgr").ensureHasValue().ensure(t => typeof t === "function" || typeof t === "object");

    //     if (typeof eventBus === "function")
    //         this._container.registerSingleton(EdaManager.eventBusKey, eventBus);
    //     else
    //         this._container.registerInstance(EdaManager.eventBusKey, eventBus);

    //     if (typeof eventSubMgr === "function")
    //         this._container.registerSingleton(EdaManager.eventSubMgrKey, eventSubMgr);
    //     else
    //         this._container.registerInstance(EdaManager.eventSubMgrKey, eventSubMgr);
    // }
}