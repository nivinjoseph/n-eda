import { given } from "@nivinjoseph/n-defensive";
import { Processor } from "./processor.js";
export class DefaultProcessor extends Processor {
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