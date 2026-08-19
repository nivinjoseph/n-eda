import { given } from "@nivinjoseph/n-defensive";
import { ObjectDisposedException } from "@nivinjoseph/n-exception";
import { ComponentInstaller, inject, Registry } from "@nivinjoseph/n-ject";
import { ConsoleLogger, LogDateTimeZone } from "@nivinjoseph/n-log";
import { Delay, Disposable, DisposableWrapper, Duration, Serializable, serialize } from "@nivinjoseph/n-util";
import { Redis } from "ioredis";
import {
    EdaEvent, EdaManager, ObserverEdaEventHandler, RedisEventBus, RedisEventSubMgr, Topic,
    observable, observedEvent, observer
} from "../../src/index.js";


/**
 * Fixtures for the distributed observer.
 *
 * The observable topic is configured with `.forcePublish()` deliberately. Observer handlers are indexed in
 * `observerEventMap`, never `eventMap`, so without force the publishing process buckets nothing and the
 * observer fan-out is skipped entirely — see known issue #7. Force is the supported workaround and lets this
 * suite exercise the real fan-out -> notify -> unwrap -> handler path.
 */

/** The observable domain type. `OrderShippedEvent.refType` must match this class name exactly. */
export class Order { }

/** The observer domain type. Passed as the first argument to `subscribeToObservables`. */
export class Customer { }


export class ObserverHistory implements Disposable
{
    private readonly _notifications = new Array<{ eventId: string; observerId: string; orderId: string; }>();

    private _isDisposed = false;

    public get notifications(): ReadonlyArray<{ eventId: string; observerId: string; orderId: string; }>
    {
        return this._notifications;
    }


    public record(eventId: string, observerId: string, orderId: string): void
    {
        given(eventId, "eventId").ensureHasValue().ensureIsString();
        given(observerId, "observerId").ensureHasValue().ensureIsString();
        given(orderId, "orderId").ensureHasValue().ensureIsString();

        if (this._isDisposed)
            throw new ObjectDisposedException("ObserverHistory");

        this._notifications.push({ eventId, observerId, orderId });
    }

    public dispose(): Promise<void>
    {
        this._isDisposed = true;
        return Promise.resolve();
    }
}


@serialize("ObserverTest")
export class OrderShippedEvent extends Serializable implements EdaEvent
{
    private readonly _id: string;
    private readonly _orderId: string;


    @serialize
    public get id(): string { return this._id; }

    @serialize // has to be serialized for eda purposes
    public get name(): string { return (<Object>OrderShippedEvent).getTypeName(); }

    @serialize
    public get orderId(): string { return this._orderId; }

    public get partitionKey(): string { return this._orderId; }

    // the consumer rebuilds the observation key from refType, so this must equal the @observable class name
    public get refId(): string { return this._orderId; }
    public get refType(): string { return (<Object>Order).getTypeName(); }


    public constructor(data: { id: string; orderId: string; })
    {
        super(data);

        const { id, orderId } = data;

        given(id, "id").ensureHasValue().ensureIsString();
        this._id = id;

        given(orderId, "orderId").ensureHasValue().ensureIsString();
        this._orderId = orderId;
    }
}

@observedEvent(OrderShippedEvent)
@observable(Order)
@observer(Customer)
@inject("ObserverHistory")
export class CustomerOrderShippedHandler implements ObserverEdaEventHandler<OrderShippedEvent>
{
    private readonly _observerHistory: ObserverHistory;


    public constructor(observerHistory: ObserverHistory)
    {
        given(observerHistory, "observerHistory").ensureHasValue().ensureIsObject();
        this._observerHistory = observerHistory;
    }


    public async handle(event: OrderShippedEvent, observerId: string): Promise<void>
    {
        given(event, "event").ensureHasValue().ensureIsObject().ensureIsType(OrderShippedEvent);
        given(observerId, "observerId").ensureHasValue().ensureIsString();

        this._observerHistory.record(event.id, observerId, event.orderId);

        return Promise.resolve();
    }
}


class ObserverComponentInstaller implements ComponentInstaller
{
    public async install(registry: Registry): Promise<void>
    {
        given(registry, "registry").ensureHasValue().ensureIsObject();

        const edaRedisClient = new Redis();
        const edaRedisClientDisposable = new DisposableWrapper(async () =>
        {
            await Delay.seconds(2);
            await new Promise<void>((resolve, _) =>
            {
                edaRedisClient.quit(() => resolve()).catch(e => console.error(e));
            });
        });

        registry
            .registerInstance("Logger", new ConsoleLogger({ logDateTimeZone: LogDateTimeZone.est }))
            .registerInstance("EdaRedisClient", edaRedisClient)
            .registerInstance("EdaRedisClientDisposable", edaRedisClientDisposable)
            .registerSingleton("ObserverHistory", ObserverHistory);
    }
}


/** The topic the observable publishes to. Publish-only, and forced so the fan-out is reachable. */
export const observableTopicName = "obs-orders";

/** The dedicated notification topic. Subscribed, so this process consumes the notifications it emits. */
export const observerTopicName = "obs-notify";


export async function createObserverEdaManager(): Promise<EdaManager>
{
    const ordersTopic = new Topic(observableTopicName, Duration.fromHours(1), 5).forcePublish();
    const notifyTopic = new Topic(observerTopicName, Duration.fromHours(1), 5).subscribe();

    const edaManager = new EdaManager();
    edaManager
        .useInstaller(new ObserverComponentInstaller())
        .useConsumerName("observer-test")
        .registerTopics(ordersTopic)
        .registerEventHandlers(CustomerOrderShippedHandler)
        .enableDistributedObserver(notifyTopic)
        .registerEventBus(RedisEventBus)
        .registerEventSubscriptionManager(RedisEventSubMgr, "observer-test-group");

    await edaManager.bootstrap();

    return edaManager;
}


/**
 * Polls until `predicate` holds or the timeout elapses. Preferable to a fixed sleep: the pub/sub doorbell
 * usually delivers in milliseconds, but the consumer's fallback poll is 2.5-5s.
 */
export async function waitFor(predicate: () => boolean, timeout = Duration.fromSeconds(20)): Promise<boolean>
{
    given(predicate, "predicate").ensureHasValue().ensureIsFunction();

    const deadline = Date.now() + timeout.toMilliSeconds();

    while (Date.now() < deadline)
    {
        if (predicate())
            return true;

        await Delay.milliseconds(100);
    }

    return predicate();
}
