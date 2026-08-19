import { given } from "@nivinjoseph/n-defensive";
import { Processor } from "./processor.js";
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
export class DefaultProcessor extends Processor {
    _onEventReceived;
    constructor(manager, onEventReceived) {
        super(manager);
        given(onEventReceived, "onEventReceived").ensureHasValue().ensureIsFunction();
        this._onEventReceived = onEventReceived;
    }
    async processEvent(workItem) {
        const isObservedEvent = workItem.eventRegistration.isObservedEvent;
        let event = workItem.event;
        if (isObservedEvent)
            event = event.observedEvent;
        const scope = this.manager.serviceLocator.createScope();
        event.$scope = scope;
        this._onEventReceived(scope, workItem.topic, event);
        const handler = scope.resolve(workItem.eventRegistration.eventHandlerTypeName);
        try {
            await handler.handle(event, workItem.event.observerId);
            // await this._logger.logInfo(`Executed EventHandler '${workItem.eventRegistration.eventHandlerTypeName}' for event '${workItem.eventName}' with id '${workItem.eventId}' => ConsumerGroupId: ${this._manager.consumerGroupId}; Topic: ${workItem.topic}; Partition: ${workItem.partition};`);
        }
        finally {
            await scope.dispose();
        }
    }
}
//# sourceMappingURL=default-processor.js.map