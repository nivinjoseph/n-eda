import { given } from "@nivinjoseph/n-defensive";
import { ServiceLocator } from "@nivinjoseph/n-ject";
import { EdaEvent } from "../eda-event.js";
import { EdaEventHandler } from "../eda-event-handler.js";
import { EdaManager } from "../eda-manager.js";
import { ObserverEdaEventHandler } from "../observer-eda-event-handler.js";
import { NedaDistributedObserverNotifyEvent } from "./neda-distributed-observer-notify-event.js";
import { Processor } from "./processor.js";
import { WorkItem } from "./scheduler.js";


/**
 * The in-process dispatcher: creates a per-event DI child scope, resolves the handler by its class name, and
 * invokes `handle`.
 *
 * Contract: one child scope per event delivery, disposed in a `finally`. The scope is also stapled onto the
 * event as `$scope`, so retaining the event past `handle()` yields a disposed container. For observed events
 * the notification envelope is unwrapped first and the inner event is passed to the handler along with the
 * `observerId`.
 *
 * Note: resolution is by handler **class name**, which is why those names must be globally unique.
 */
export class DefaultProcessor extends Processor
{
    private readonly _onEventReceived: (scope: ServiceLocator, topic: string, event: EdaEvent) => void;


    public constructor(manager: EdaManager, onEventReceived: (scope: ServiceLocator, topic: string, event: EdaEvent) => void)
    {
        super(manager);

        given(onEventReceived, "onEventReceived").ensureHasValue().ensureIsFunction();
        this._onEventReceived = onEventReceived;
    }


    protected async processEvent(workItem: WorkItem): Promise<void>
    {
        const isObservedEvent = workItem.eventRegistration.isObservedEvent;
        let event = workItem.event;
        if (isObservedEvent)
            event = (event as NedaDistributedObserverNotifyEvent).observedEvent;

        const scope = this.manager.serviceLocator.createScope();
        (<any>event).$scope = scope;

        this._onEventReceived(scope, workItem.topic, event);

        const handler = scope.resolve<EdaEventHandler<EdaEvent> | ObserverEdaEventHandler<EdaEvent>>(workItem.eventRegistration.eventHandlerTypeName);

        try 
        {
            await handler.handle(event, (workItem.event as NedaDistributedObserverNotifyEvent).observerId);

            // await this._logger.logInfo(`Executed EventHandler '${workItem.eventRegistration.eventHandlerTypeName}' for event '${workItem.eventName}' with id '${workItem.eventId}' => ConsumerGroupId: ${this._manager.consumerGroupId}; Topic: ${workItem.topic}; Partition: ${workItem.partition};`);
        }
        finally
        {
            await scope.dispose();
        }
    }
}