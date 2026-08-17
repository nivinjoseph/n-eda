import { given } from "@nivinjoseph/n-defensive";
import { Exception } from "@nivinjoseph/n-exception";
import { ServiceLocator } from "@nivinjoseph/n-ject";
import { Logger } from "@nivinjoseph/n-log";
import { Deserializer } from "@nivinjoseph/n-util";
import { EdaEvent } from "../eda-event.js";
import { EdaEventHandler } from "../eda-event-handler.js";
import { EdaManager } from "../eda-manager.js";
import { ObserverEdaEventHandler } from "../observer-eda-event-handler.js";
import { RpcModel } from "../rpc-details.js";
import { NedaDistributedObserverNotifyEvent } from "./neda-distributed-observer-notify-event.js";


/**
 * Executes events in an HTTP RPC consumer process that were proxied to it by a process running the Redis
 * consume loop.
 *
 * Contract: construct one, hand it to `EdaManager.actAsRpcConsumer(...)`, and register it on an `RpcServer`.
 * The producing side must have called `EdaManager.proxyToRpc(...)`.
 *
 * RULE: a custom RPC endpoint standing in for `RpcServer` must echo `eventName` and `eventId` back exactly —
 * that echo is how `RpcProxyProcessor` detects success. An endpoint that omits them makes every event burn
 * all 10 retries.
 *
 * Note: `EdaContext.topic` is unavailable on this path, and distributed observer events are not dispatched
 * correctly under proxying; see `docs/known-issues.md`.
 */
export class RpcEventHandler
{
    private readonly _nedaDistributedObserverNotifyEventName = (<Object>NedaDistributedObserverNotifyEvent).getTypeName();
    private _manager: EdaManager | null = null;
    private _logger: Logger | null = null;


    /**
     * Binds the handler to its manager. Called by `EdaManager.bootstrap()` — never call it yourself.
     *
     * @param manager - the bootstrapping manager
     * @throws if the manager is missing, is not an `EdaManager`, or was not configured with
     * `actAsRpcConsumer`
     */
    public initialize(manager: EdaManager): void
    {
        given(manager, "manager").ensureHasValue().ensureIsObject().ensureIsType(EdaManager)
            .ensure(t => t.isRpcConsumer, "RPC consumer not enabled");
        this._manager = manager;

        this._logger = this._manager.serviceLocator.resolve<Logger>("Logger");
    }


    /**
     * Deserializes a proxied event, resolves its handler in a fresh DI scope, and runs it.
     *
     * Contract: **returns** a failure object rather than throwing, and `RpcServer` sends it with HTTP 200 —
     * the error lives in the body, not the status line.
     *
     * @param model - the proxied request: consumer id, topic, partition, event name, and serialized payload
     * @returns `{ eventName, eventId }` on success, or `{ statusCode, error }` on failure
     */
    public async process(model: RpcModel)
        : Promise<{ eventName: string; eventId: string; } | { statusCode: number; error: string; }>
    {
        try 
        {
            given(model, "model").ensureHasValue().ensureIsObject();

            given(this, "this").ensure(t => t._manager != null, "not initialized");

            const eventData: EventInfo = {
                consumerId: model.consumerId,
                topic: model.topic,
                partition: model.partition,
                eventName: model.eventName,
                event: Deserializer.deserialize<EdaEvent>(model.payload)
            };

            await this._process(eventData);

            return {
                eventName: eventData.eventName,
                eventId: eventData.event.id
            };
        }
        catch (error)
        {
            return {
                statusCode: 500,
                error: this._getErrorMessage(error)
            };
        }
    }

    /**
     * Hook invoked after the per-event DI scope is created and before the handler runs.
     *
     * Note: a **no-op** in this class, which is why `EdaContext.topic` throws under RPC proxying. Override it
     * to populate per-event scope state yourself.
     *
     * @param scope - the child scope for this delivery
     * @param topic - the topic that delivered the event
     * @param event - the deserialized event
     */
    protected onEventReceived(scope: ServiceLocator, topic: string, event: EdaEvent): void
    {
        given(scope, "scope").ensureHasValue().ensureIsObject();
        given(topic, "topic").ensureHasValue().ensureIsString();
        given(event, "event").ensureHasValue().ensureIsObject();
    }

    private async _process(data: EventInfo): Promise<void>
    {
        // given(data, "data").ensureHasValue().ensureIsObject()
        //     .ensureHasStructure({
        //         consumerId: "string",
        //         topic: "string",
        //         partition: "number",
        //         eventName: "string",
        //         event: "object"
        //     });

        const isObservedEvent = data.eventName === this._nedaDistributedObserverNotifyEventName;
        let event = data.event;
        if (isObservedEvent)
            event = (event as NedaDistributedObserverNotifyEvent).observedEvent;

        const eventRegistration = isObservedEvent
            ? this._manager!.observerEventMap.get(event.name)
            : this._manager!.eventMap.get(event.name);

        if (eventRegistration == null) // Because we check event registrations on publish, if the registration is null here, then that is a consequence of rolling deployment
            return;

        const scope = this._manager!.serviceLocator.createScope();
        (<any>event).$scope = scope;

        this.onEventReceived(scope, data.topic, event);

        const handler = scope.resolve<EdaEventHandler<EdaEvent> | ObserverEdaEventHandler<EdaEvent>>(eventRegistration.eventHandlerTypeName);

        try 
        {
            await handler.handle(event, (data.event as NedaDistributedObserverNotifyEvent).observerId);
        }
        catch (error: any)
        {
            await this._logger!.logWarning(`Error in RPC event handler while handling event of type '${data.eventName}' with data ${JSON.stringify(data.event.serialize())}.`);
            await this._logger!.logError(error);
            throw error;
        }
        finally
        {
            await scope.dispose();
        }
    }

    private _getErrorMessage(exp: Exception | Error | any): string
    {
        let logMessage: string;
        try 
        {
            if (exp instanceof Exception)
                logMessage = exp.toString();
            else if (exp instanceof Error)
                logMessage = exp.stack!;
            else
                logMessage = (<object>exp).toString();
        }
        catch (error)
        {
            console.warn(error);
            logMessage = "There was an error while attempting to log another message.";
        }

        return logMessage;
    }
}


interface EventInfo
{
    consumerId: string;
    topic: string;
    partition: number;
    eventName: string;
    event: EdaEvent;
}