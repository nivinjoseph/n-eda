import { given } from "@nivinjoseph/n-defensive";
import { ComponentInstaller, inject, Registry } from "@nivinjoseph/n-ject";
import { ConsoleLogger, LogDateTimeZone, Logger } from "@nivinjoseph/n-log";
import { Delay, Disposable, DisposableWrapper, Duration, Serializable, serialize } from "@nivinjoseph/n-util";
import { Redis } from "ioredis";
import { EdaEventHandler, EventBus, EdaEvent, EdaManager, RedisEventBus, RedisEventSubMgr, Topic, event } from "../../src/index.js";
import { ObjectDisposedException } from "@nivinjoseph/n-exception";


export class EventHistory implements Disposable
{
    private readonly _historicalRecords = new Array<string>();

    private _startedAt = Date.now();
    private _lastEventAt = Date.now();
    private _isDisposed = false;

    public get records(): ReadonlyArray<string> { return this._historicalRecords; }


    public async recordEvent(event: EdaEvent): Promise<void>
    {
        given(event, "event").ensureHasValue().ensureIsObject();

        if (this._isDisposed)
            throw new ObjectDisposedException("EventHistory");

        await Delay.milliseconds(10);

        this._historicalRecords.push(event.id);
        this._lastEventAt = Date.now();
    }

    public startProfiling(): void
    {
        this._startedAt = Date.now();
    }

    public endProfiling(): number
    {
        return this._lastEventAt - this._startedAt;
    }

    public dispose(): Promise<void>
    {
        this._isDisposed = true;
        return Promise.resolve();
    }
}

class CommonComponentInstaller implements ComponentInstaller
{
    public install(registry: Registry): void
    {
        given(registry, "registry").ensureHasValue().ensureIsObject();

        // const edaRedisClient = Redis.createClient({ return_buffers: true });
        const edaRedisClient = new Redis();
        const edaRedisClientDisposable = new DisposableWrapper(async () =>
        {
            await Delay.seconds(5);
            await new Promise<void>((resolve, _) =>
            {
                edaRedisClient.quit(() => resolve()).catch(e => console.error(e));
            });
        });

        registry
            .registerInstance("Logger", new ConsoleLogger({ logDateTimeZone: LogDateTimeZone.est }))
            .registerInstance("EdaRedisClient", edaRedisClient)
            .registerInstance("EdaRedisClientDisposable", edaRedisClientDisposable)
            .registerSingleton("EventHistory", EventHistory);
    }
}


@serialize
export class TestEvent extends Serializable implements EdaEvent
{
    private readonly _id: string;


    @serialize
    public get id(): string { return this._id; }

    @serialize // has to be serialized for eda purposes
    public get name(): string { return (<Object>TestEvent).getTypeName(); }

    public get partitionKey(): string { return this.id.split("-")[0]; }

    public get refId(): string { return "neda"; } // TODO: Should be changed if this event is used for distributed observer
    public get refType(): string { return "neda"; } // TODO: Should be changed if this event is used for distributed observer


    public constructor(data: { id: string; })
    {
        super(data);

        const { id } = data;

        given(id, "id").ensureHasValue().ensureIsString();
        this._id = id;
    }
}

@serialize
export class AnalyticEvent extends Serializable implements EdaEvent
{
    private readonly _id: string;
    private readonly _message: string;


    @serialize
    public get id(): string { return this._id; }

    @serialize // has to be serialized for eda purposes
    public get name(): string { return (<Object>AnalyticEvent).getTypeName(); }

    public get partitionKey(): string { return this.id.split("-")[0]; }

    @serialize
    public get message(): string { return this._message; }

    public get refId(): string { return "neda"; } // TODO: Should be changed if this event is used for distributed observer
    public get refType(): string { return "neda"; } // TODO: Should be changed if this event is used for distributed observer


    public constructor(data: { id: string; message: string; })
    {
        super(data);

        const { id, message } = data;

        given(id, "id").ensureHasValue().ensureIsString();
        this._id = id;

        given(message, "message").ensureHasValue().ensureIsString();
        this._message = message;
    }
}


@event(TestEvent)
@inject("Logger", "EventHistory", "EventBus")
class TestEventHandler implements EdaEventHandler<TestEvent>
{
    // @ts-expect-error: not used atm
    private readonly _logger: Logger;
    private readonly _eventHistory: EventHistory;
    private readonly _eventBus: EventBus;


    public constructor(logger: Logger, eventHistory: EventHistory, eventBus: EventBus)
    {
        given(logger, "logger").ensureHasValue().ensureIsObject();
        this._logger = logger;

        given(eventHistory, "eventHistory").ensureHasValue().ensureIsObject();
        this._eventHistory = eventHistory;

        given(eventBus, "eventBus").ensureHasValue().ensureIsObject();
        this._eventBus = eventBus;
    }


    public async handle(event: TestEvent): Promise<void>
    {
        given(event, "event").ensureHasValue().ensureIsObject().ensureIsType(TestEvent);

        await this._eventHistory.recordEvent(event);

        const message = `Event '${event.name}' with id '${event.id}'.`;

        await this._eventBus.publish("analytic", new AnalyticEvent({ id: `analytic_${event.id}_${Date.now()}`, message }));
    }
}

@event(AnalyticEvent)
@inject("Logger", "EventHistory")
class AnalyticEventHandler implements EdaEventHandler<AnalyticEvent>
{
    private readonly _logger: Logger;
    private readonly _eventHistory: EventHistory;


    public constructor(logger: Logger, eventHistory: EventHistory)
    {
        given(logger, "logger").ensureHasValue().ensureIsObject();
        this._logger = logger;

        given(eventHistory, "eventHistory").ensureHasValue().ensureIsObject();
        this._eventHistory = eventHistory;
    }


    public async handle(event: AnalyticEvent): Promise<void>
    {
        given(event, "event").ensureHasValue().ensureIsObject().ensureIsType(AnalyticEvent);

        await this._eventHistory.recordEvent(event);

        await this._logger.logInfo(event.message);
    }
}

export function createEdaManager(): EdaManager
{
    const basicTopic = new Topic("basic", Duration.fromHours(1), 25).subscribe();
    const analyticTopic = new Topic("analytic", Duration.fromHours(1), 25).subscribe();
    const edaManager = new EdaManager();
    edaManager
        .useInstaller(new CommonComponentInstaller())
        .registerEventSubscriptionManager(RedisEventSubMgr, "main")
        .cleanUpKeys()
        // .proxyToAwsLambda("testFunc")
        .useConsumerName("test")
        .registerTopics(analyticTopic, basicTopic)
        // .usePartitionKeyMapper((event) =>
        // {
        //     const id = event.id;
        //     return id.contains("-") ? id.split("-")[0] : id;
        // })
        .registerEventHandlers(AnalyticEventHandler, TestEventHandler)
        // .registerEventHandlerTracer(async (eventInfo, exec) =>
        // {
        //     console.log(`Starting tracing event ${eventInfo.eventName} with id ${eventInfo.eventId}`);

        //     await exec();

        //     console.log(`Finished tracing event ${eventInfo.eventName} with id ${eventInfo.eventId}`);
        // })
        .registerEventBus(RedisEventBus);

    edaManager.bootstrap();

    return edaManager;
}