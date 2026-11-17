import { given } from "@nivinjoseph/n-defensive";
import { ComponentInstaller, inject, Registry } from "@nivinjoseph/n-ject";
import { ConsoleLogger, LogDateTimeZone } from "@nivinjoseph/n-log";
import { Delay, DisposableWrapper, Duration, Serializable, serialize } from "@nivinjoseph/n-util";
import { Redis } from "ioredis";
import {
    EdaEvent, EdaEventHandler, EdaManager, ObserverEdaEventHandler, RedisEventBus, RedisEventSubMgr, Topic,
    event, observable, observedEvent, observer, topic
} from "../../src/index.js";


/**
 * Fixtures for events addressed to topics with `@topic`.
 *
 * Three managers stand in for three services sharing one Redis: a sender that handles nothing, and two
 * receivers that each own a topic. The sender's destination topics are `.forcePublish()`ed because a
 * declared topic follows the same publish-time rule as an explicit one — without force, an event with no
 * local handler is dropped. `msg-orders` is deliberately left unforced to show exactly that.
 *
 * Every topic has a single partition so a test can read a topic's write index straight from Redis.
 */

export const ordersTopicName = "msg-orders";
export const billingTopicName = "msg-billing";
export const shippingTopicName = "msg-shipping";
export const auditTopicName = "msg-audit";
export const notifyTopicName = "msg-notify";
export const unregisteredTopicName = "msg-unregistered";


/** Redis key holding the number of batches ever written to a single-partition topic. */
export function writeIndexKey(topicName: string): string
{
    given(topicName, "topicName").ensureHasValue().ensureIsString();

    return `{n-eda-${topicName}-0}-write-index`;
}


/** Records which events a service's handlers were given. One instance per receiving manager. */
export class MessagingHistory
{
    private readonly _eventIds = new Array<string>();


    public record(eventId: string): void
    {
        given(eventId, "eventId").ensureHasValue().ensureIsString();

        this._eventIds.push(eventId);
    }

    public count(eventId: string): number
    {
        given(eventId, "eventId").ensureHasValue().ensureIsString();

        return this._eventIds.filter(t => t === eventId).length;
    }
}


/** The observable and observer domain types for the observer fixture. */
export class MsgOrder { }
export class MsgCustomer { }


abstract class MessagingTestEvent extends Serializable implements EdaEvent
{
    private readonly _id: string;
    private readonly _refId: string | null;


    @serialize
    public get id(): string { return this._id; }

    @serialize // has to be serialized for eda purposes
    public get name(): string { return (<Object>this).getTypeName(); }

    public get partitionKey(): string { return this._id; }

    public get refId(): string { return this._refId ?? "neda"; }
    public get refType(): string { return "neda"; }


    public constructor(data: { id: string; refId?: string; })
    {
        super(data);

        const { id, refId } = data;

        given(id, "id").ensureHasValue().ensureIsString();
        this._id = id;

        given(refId, "refId").ensureIsString();
        this._refId = refId ?? null;
    }
}

/** Addressed to two services, each of which has its own handler for it. */
@topic(billingTopicName, shippingTopicName)
@serialize("MessagingTest")
export class MsgOrderShippedEvent extends MessagingTestEvent { }

/** Addressed to two topics that the billing service both subscribes to. */
@topic(billingTopicName, auditTopicName)
@serialize("MessagingTest")
export class MsgAuditEvent extends MessagingTestEvent { }

/** Addressed to a topic the sender does not force-publish. */
@topic(ordersTopicName)
@serialize("MessagingTest")
export class MsgLocalEvent extends MessagingTestEvent { }

/** Not addressed to anything; only publishable with an explicit topic. */
@serialize("MessagingTest")
export class MsgPlainEvent extends MessagingTestEvent { }

/** Addressed to one registered topic and one that no manager registers. */
@topic(billingTopicName, unregisteredTopicName)
@serialize("MessagingTest")
export class MsgMisaddressedEvent extends MessagingTestEvent { }

/** Addressed to the distributed observer topic, which nothing may publish to directly. */
@topic(notifyTopicName)
@serialize("MessagingTest")
export class MsgToObserverTopicEvent extends MessagingTestEvent { }

/** Addressed to two topics and emitted by an observable, so it also goes through the observer fan-out. */
@topic(shippingTopicName, auditTopicName)
@serialize("MessagingTest")
export class MsgObservedEvent extends MessagingTestEvent
{
    public override get refType(): string { return (<Object>MsgOrder).getTypeName(); }
}

/**
 * Emitted by an observable, but written nowhere by the observing sender: `msg-orders` is not
 * force-published there and `msg-billing` is disabled.
 */
@topic(ordersTopicName, billingTopicName)
@serialize("MessagingTest")
export class MsgUnwrittenObservedEvent extends MessagingTestEvent
{
    public override get refType(): string { return (<Object>MsgOrder).getTypeName(); }
}

/**
 * Emitted by an observable and addressed only to `msg-billing`, which the observing sender has switched
 * off. That sender writes it nowhere, but with no enabled target it still notifies the event's observers.
 */
@topic(billingTopicName)
@serialize("MessagingTest")
export class MsgDisabledOnlyObservedEvent extends MessagingTestEvent
{
    public override get refType(): string { return (<Object>MsgOrder).getTypeName(); }
}


@event(MsgOrderShippedEvent)
@inject("MessagingHistory")
class BillingOrderShippedEventHandler implements EdaEventHandler<MsgOrderShippedEvent>
{
    private readonly _history: MessagingHistory;


    public constructor(history: MessagingHistory)
    {
        given(history, "history").ensureHasValue().ensureIsObject();
        this._history = history;
    }


    public async handle(event: MsgOrderShippedEvent): Promise<void>
    {
        given(event, "event").ensureHasValue().ensureIsObject().ensureIsType(MsgOrderShippedEvent);

        this._history.record(event.id);

        return Promise.resolve();
    }
}

@event(MsgAuditEvent)
@inject("MessagingHistory")
class BillingAuditEventHandler implements EdaEventHandler<MsgAuditEvent>
{
    private readonly _history: MessagingHistory;


    public constructor(history: MessagingHistory)
    {
        given(history, "history").ensureHasValue().ensureIsObject();
        this._history = history;
    }


    public async handle(event: MsgAuditEvent): Promise<void>
    {
        given(event, "event").ensureHasValue().ensureIsObject().ensureIsType(MsgAuditEvent);

        this._history.record(event.id);

        return Promise.resolve();
    }
}

@event(MsgPlainEvent)
@inject("MessagingHistory")
class BillingPlainEventHandler implements EdaEventHandler<MsgPlainEvent>
{
    private readonly _history: MessagingHistory;


    public constructor(history: MessagingHistory)
    {
        given(history, "history").ensureHasValue().ensureIsObject();
        this._history = history;
    }


    public async handle(event: MsgPlainEvent): Promise<void>
    {
        given(event, "event").ensureHasValue().ensureIsObject().ensureIsType(MsgPlainEvent);

        this._history.record(event.id);

        return Promise.resolve();
    }
}

@event(MsgOrderShippedEvent)
@inject("MessagingHistory")
class ShippingOrderShippedEventHandler implements EdaEventHandler<MsgOrderShippedEvent>
{
    private readonly _history: MessagingHistory;


    public constructor(history: MessagingHistory)
    {
        given(history, "history").ensureHasValue().ensureIsObject();
        this._history = history;
    }


    public async handle(event: MsgOrderShippedEvent): Promise<void>
    {
        given(event, "event").ensureHasValue().ensureIsObject().ensureIsType(MsgOrderShippedEvent);

        this._history.record(event.id);

        return Promise.resolve();
    }
}

/** Never dispatched here; it exists so the observing sender can accept the observer subscription. */
@observedEvent(MsgObservedEvent)
@observable(MsgOrder)
@observer(MsgCustomer)
class MsgCustomerObservedEventHandler implements ObserverEdaEventHandler<MsgObservedEvent>
{
    public async handle(event: MsgObservedEvent, observerId: string): Promise<void>
    {
        given(event, "event").ensureHasValue().ensureIsObject().ensureIsType(MsgObservedEvent);
        given(observerId, "observerId").ensureHasValue().ensureIsString();

        return Promise.resolve();
    }
}

/** Never dispatched here; it exists so the observing sender can accept the observer subscription. */
@observedEvent(MsgUnwrittenObservedEvent)
@observable(MsgOrder)
@observer(MsgCustomer)
class MsgCustomerUnwrittenObservedEventHandler implements ObserverEdaEventHandler<MsgUnwrittenObservedEvent>
{
    public async handle(event: MsgUnwrittenObservedEvent, observerId: string): Promise<void>
    {
        given(event, "event").ensureHasValue().ensureIsObject().ensureIsType(MsgUnwrittenObservedEvent);
        given(observerId, "observerId").ensureHasValue().ensureIsString();

        return Promise.resolve();
    }
}

/** Never dispatched here; it exists so the observing sender can accept the observer subscription. */
@observedEvent(MsgDisabledOnlyObservedEvent)
@observable(MsgOrder)
@observer(MsgCustomer)
class MsgCustomerDisabledOnlyObservedEventHandler implements ObserverEdaEventHandler<MsgDisabledOnlyObservedEvent>
{
    public async handle(event: MsgDisabledOnlyObservedEvent, observerId: string): Promise<void>
    {
        given(event, "event").ensureHasValue().ensureIsObject().ensureIsType(MsgDisabledOnlyObservedEvent);
        given(observerId, "observerId").ensureHasValue().ensureIsString();

        return Promise.resolve();
    }
}


class MessagingComponentInstaller implements ComponentInstaller
{
    private readonly _history: MessagingHistory;


    public constructor(history: MessagingHistory)
    {
        given(history, "history").ensureHasValue().ensureIsObject();
        this._history = history;
    }


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
            .registerInstance("MessagingHistory", this._history);
    }
}


function createTopic(name: string): Topic
{
    return new Topic(name, Duration.fromHours(1), 1);
}

/** A service that only sends: no handlers, no subscriptions. */
export async function createSenderEdaManager(): Promise<EdaManager>
{
    const edaManager = new EdaManager();
    edaManager
        .useInstaller(new MessagingComponentInstaller(new MessagingHistory()))
        .useConsumerName("msg-sender")
        .registerTopics(
            createTopic(ordersTopicName),
            createTopic(billingTopicName).forcePublish(),
            createTopic(shippingTopicName).forcePublish(),
            createTopic(auditTopicName).forcePublish())
        .registerEventBus(RedisEventBus);

    await edaManager.bootstrap();

    return edaManager;
}

/** The billing service: owns `msg-billing`, and also listens on `msg-audit`. */
export async function createBillingEdaManager(history: MessagingHistory): Promise<EdaManager>
{
    given(history, "history").ensureHasValue().ensureIsObject();

    const edaManager = new EdaManager();
    edaManager
        .useInstaller(new MessagingComponentInstaller(history))
        .useConsumerName("msg-billing")
        .registerTopics(createTopic(billingTopicName).subscribe(), createTopic(auditTopicName).subscribe())
        .registerEventHandlers(BillingOrderShippedEventHandler, BillingAuditEventHandler, BillingPlainEventHandler)
        .registerEventBus(RedisEventBus)
        .registerEventSubscriptionManager(RedisEventSubMgr, "msg-billing-group");

    await edaManager.bootstrap();

    return edaManager;
}

/** The shipping service: owns `msg-shipping`, and handles only `MsgOrderShippedEvent`. */
export async function createShippingEdaManager(history: MessagingHistory): Promise<EdaManager>
{
    given(history, "history").ensureHasValue().ensureIsObject();

    const edaManager = new EdaManager();
    edaManager
        .useInstaller(new MessagingComponentInstaller(history))
        .useConsumerName("msg-shipping")
        .registerTopics(createTopic(shippingTopicName).subscribe())
        .registerEventHandlers(ShippingOrderShippedEventHandler)
        .registerEventBus(RedisEventBus)
        .registerEventSubscriptionManager(RedisEventSubMgr, "msg-shipping-group");

    await edaManager.bootstrap();

    return edaManager;
}

/**
 * A second sender with the distributed observer enabled and `msg-billing` switched off, for the cases that
 * depend on those two settings. Like the first sender, it does not force-publish `msg-orders`.
 */
export async function createObservingSenderEdaManager(): Promise<EdaManager>
{
    const edaManager = new EdaManager();
    edaManager
        .useInstaller(new MessagingComponentInstaller(new MessagingHistory()))
        .useConsumerName("msg-observing-sender")
        .registerTopics(
            createTopic(ordersTopicName),
            createTopic(billingTopicName).forcePublish().disable(),
            createTopic(shippingTopicName).forcePublish(),
            createTopic(auditTopicName).forcePublish())
        .registerEventHandlers(
            MsgCustomerObservedEventHandler,
            MsgCustomerUnwrittenObservedEventHandler,
            MsgCustomerDisabledOnlyObservedEventHandler)
        .enableDistributedObserver(createTopic(notifyTopicName))
        .registerEventBus(RedisEventBus);

    await edaManager.bootstrap();

    return edaManager;
}
