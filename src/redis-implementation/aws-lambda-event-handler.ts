import { given } from "@nivinjoseph/n-defensive";
import { Exception } from "@nivinjoseph/n-exception";
import { ServiceLocator } from "@nivinjoseph/n-ject";
import { Logger } from "@nivinjoseph/n-log";
import { Deserializer } from "@nivinjoseph/n-util";
import { EdaEvent } from "../eda-event.js";
import { EdaEventHandler } from "../eda-event-handler.js";
import { EdaManager } from "../eda-manager.js";
import { ObserverEdaEventHandler } from "../observer-eda-event-handler.js";
import { NedaDistributedObserverNotifyEvent } from "./neda-distributed-observer-notify-event.js";


export class AwsLambdaEventHandler
{
    private readonly _nedaDistributedObserverNotifyEventName = (<Object>NedaDistributedObserverNotifyEvent).getTypeName();
    private _manager: EdaManager | null = null;
    private _logger: Logger | null = null;
    
    
    public initialize(manager: EdaManager): void
    {
        given(manager, "manager").ensureHasValue().ensureIsObject().ensureIsType(EdaManager)
            .ensure(t => t.isAwsLambdaConsumer, "AWS Lambda consumer not enabled");
        this._manager = manager;

        this._logger = this._manager.serviceLocator.resolve<Logger>("Logger");
    }
    
    
    public async process(event: object, context: Record<string, any>)
        : Promise<{ eventName: string; eventId: string; } | { statusCode: number; error: string; }>
    {
        given(event, "event").ensureHasValue().ensureIsObject();
        given(context, "context").ensureHasValue().ensureIsObject();
        
        given(this, "this").ensure(t => t._manager != null, "not initialized");
        
        const ctx = context.clientContext;
        
        const eventData: EventInfo = {
            consumerId: ctx.consumerId,
            topic: ctx.topic,
            partition: ctx.partition,
            eventName: ctx.eventName,
            event: Deserializer.deserialize<EdaEvent>(event)
        };
        
        try 
        {
            await this._process(eventData);
        }
        catch (error)
        {
            return {
                statusCode: 500,
                error: this._getErrorMessage(error)
            };
        }
        
        return {
            eventName: eventData.eventName,
            eventId: eventData.event.id
        };
    }
    
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
            await this._logger!.logWarning(`Error in EventHandler while handling event of type '${data.eventName}' with data ${JSON.stringify(data.event.serialize())}.`);
            await this._logger!.logWarning(error);
            throw error;
        }
        finally
        {
            await scope.dispose();
        }
    }
    
    private _getErrorMessage(exp: Exception | Error | any): string
    {
        let logMessage = "";
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