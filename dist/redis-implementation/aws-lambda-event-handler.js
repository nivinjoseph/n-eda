import { given } from "@nivinjoseph/n-defensive";
import { Exception } from "@nivinjoseph/n-exception";
import { Deserializer } from "@nivinjoseph/n-util";
import { EdaManager } from "../eda-manager.js";
import { NedaDistributedObserverNotifyEvent } from "./neda-distributed-observer-notify-event.js";
/**
 * Executes events inside an AWS Lambda that were proxied to it by a process running the Redis consume loop.
 *
 * Contract: construct one in the Lambda, hand it to `EdaManager.actAsAwsLambdaConsumer(...)`, and delegate
 * the Lambda entry point to {@link AwsLambdaEventHandler.process}. The producing side must have called
 * `EdaManager.proxyToAwsLambda(...)`.
 *
 * Note: `EdaContext.topic` is unavailable on this path — {@link AwsLambdaEventHandler.onEventReceived} is a
 * no-op here. Distributed observer events are also not dispatched correctly under proxying; see
 * `docs/known-issues.md`.
 */
export class AwsLambdaEventHandler {
    _nedaDistributedObserverNotifyEventName = NedaDistributedObserverNotifyEvent.getTypeName();
    _manager = null;
    _logger = null;
    /**
     * Binds the handler to its manager. Called by `EdaManager.bootstrap()` — never call it yourself.
     *
     * @param manager - the bootstrapping manager
     * @throws if the manager is missing, is not an `EdaManager`, or was not configured with
     * `actAsAwsLambdaConsumer`
     */
    initialize(manager) {
        given(manager, "manager").ensureHasValue().ensureIsObject().ensureIsType(EdaManager)
            .ensure(t => t.isAwsLambdaConsumer, "AWS Lambda consumer not enabled");
        this._manager = manager;
        this._logger = this._manager.serviceLocator.resolve("Logger");
    }
    /**
     * Deserializes a proxied event, resolves its handler in a fresh DI scope, and runs it.
     *
     * Contract: **returns** a failure object rather than throwing — `{ statusCode, error }`. Contrast
     * `GrpcEventHandler.process`, which throws. The success shape echoes `eventName` and `eventId`, which the
     * proxying side uses to confirm the event was handled.
     *
     * @param event - the proxied payload: consumer id, topic, partition, event name, and serialized event
     * @param context - the Lambda invocation context
     * @returns `{ eventName, eventId }` on success, or `{ statusCode, error }` on failure
     */
    async process(event, context) {
        given(event, "event").ensureHasValue().ensureIsObject();
        given(context, "context").ensureHasValue().ensureIsObject();
        given(this, "this").ensure(t => t._manager != null, "not initialized");
        const ctx = context.clientContext;
        const eventData = {
            consumerId: ctx.consumerId,
            topic: ctx.topic,
            partition: ctx.partition,
            eventName: ctx.eventName,
            event: Deserializer.deserialize(event)
        };
        try {
            await this._process(eventData);
        }
        catch (error) {
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
    /**
     * Hook invoked after the per-event DI scope is created and before the handler runs.
     *
     * Note: a **no-op** in this class, unlike `RedisEventSubMgr`'s override — which is why `EdaContext.topic`
     * throws under Lambda proxying. Override it to populate per-event scope state yourself.
     *
     * @param scope - the child scope for this delivery
     * @param topic - the topic that delivered the event
     * @param event - the deserialized event
     */
    onEventReceived(scope, topic, event) {
        given(scope, "scope").ensureHasValue().ensureIsObject();
        given(topic, "topic").ensureHasValue().ensureIsString();
        given(event, "event").ensureHasValue().ensureIsObject();
    }
    async _process(data) {
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
            event = event.observedEvent;
        const eventRegistration = isObservedEvent
            ? this._manager.observerEventMap.get(event.name)
            : this._manager.eventMap.get(event.name);
        if (eventRegistration == null) // Because we check event registrations on publish, if the registration is null here, then that is a consequence of rolling deployment
            return;
        const scope = this._manager.serviceLocator.createScope();
        event.$scope = scope;
        this.onEventReceived(scope, data.topic, event);
        const handler = scope.resolve(eventRegistration.eventHandlerTypeName);
        try {
            await handler.handle(event, data.event.observerId);
        }
        catch (error) {
            await this._logger.logWarning(`Error in EventHandler while handling event of type '${data.eventName}' with data ${JSON.stringify(data.event.serialize())}.`);
            await this._logger.logWarning(error);
            throw error;
        }
        finally {
            await scope.dispose();
        }
    }
    _getErrorMessage(exp) {
        let logMessage;
        try {
            if (exp instanceof Exception)
                logMessage = exp.toString();
            else if (exp instanceof Error)
                logMessage = exp.stack;
            else
                logMessage = exp.toString();
        }
        catch (error) {
            console.warn(error);
            logMessage = "There was an error while attempting to log another message.";
        }
        return logMessage;
    }
}
//# sourceMappingURL=aws-lambda-event-handler.js.map