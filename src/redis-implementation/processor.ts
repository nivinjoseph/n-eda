import { given } from "@nivinjoseph/n-defensive";
import { ApplicationException, Exception, InvalidOperationException, ObjectDisposedException } from "@nivinjoseph/n-exception";
import { Logger } from "@nivinjoseph/n-log";
import { Delay, DelayCanceller, Disposable, Observable, Observer } from "@nivinjoseph/n-util";
import { EdaManager } from "../eda-manager.js";
import * as otelApi from "@opentelemetry/api";
import {
    ATTR_MESSAGING_SYSTEM,
    ATTR_MESSAGING_CONSUMER_GROUP_NAME,
    ATTR_MESSAGING_OPERATION_NAME,
    ATTR_MESSAGING_OPERATION_TYPE,
    ATTR_MESSAGING_DESTINATION_NAME,
    ATTR_MESSAGING_DESTINATION_TEMPORARY,
    ATTR_MESSAGING_MESSAGE_ID,
    ATTR_MESSAGING_MESSAGE_CONVERSATION_ID
} from "@opentelemetry/semantic-conventions/incubating";
import { ATTR_ERROR_TYPE } from "@opentelemetry/semantic-conventions";
import {
    ATTR_NEDA_DROP_REASON,
    ATTR_NEDA_EVENT_NAME,
    ATTR_NEDA_OUTCOME,
    ATTR_NEDA_PROXY_KIND,
    errorTypeOf,
    instruments,
    MESSAGING_SYSTEM,
    NedaProxyKind
} from "../metrics.js";
import { WorkItem } from "./scheduler.js";


export abstract class Processor implements Disposable
{
    private readonly _manager: EdaManager;
    private readonly _logger: Logger;
    private readonly _availabilityObserver = new Observer<this>("available");
    private readonly _doneProcessingObserver = new Observer<WorkItem>("done-processing");

    private _currentWorkItem: WorkItem | null = null;
    private _processPromise: Promise<void> | null = null;
    private _isDisposed = false;
    private _delayCanceller: DelayCanceller | null = null;


    private get _isInitialized(): boolean
    {
        return this._availabilityObserver.hasSubscriptions && this._doneProcessingObserver.hasSubscriptions;
    }

    protected get manager(): EdaManager { return this._manager; }
    protected get logger(): Logger { return this._logger; }

    public get availability(): Observable<this> { return this._availabilityObserver; }
    public get doneProcessing(): Observable<WorkItem> { return this._doneProcessingObserver; }
    public get isBusy(): boolean { return this._currentWorkItem != null; }


    public constructor(manager: EdaManager)
    {
        given(manager, "manager").ensureHasValue().ensureIsObject().ensureIsType(EdaManager);
        this._manager = manager;

        this._logger = this._manager.serviceLocator.resolve<Logger>("Logger");
    }


    public process(workItem: WorkItem): void
    {
        if (!this._isInitialized || this.isBusy)
            throw new InvalidOperationException("processor not initialized or processor is busy");

        if (this._isDisposed)
        {
            workItem.deferred.reject(new ObjectDisposedException("Processor"));
            return;
        }

        this._currentWorkItem = workItem;
        
        this._processPromise = this._process()
            .then(() =>
            {
                const doneWorkItem = this._currentWorkItem!;
                this._doneProcessingObserver.notify(doneWorkItem);
                this._currentWorkItem = null;
                if (!this._isDisposed)
                    this._availabilityObserver.notify(this);
            })
            .catch((e) => this._logger.logError(e));
    }

    public dispose(): Promise<void>
    {
        if (!this._isDisposed)
        {
            this._isDisposed = true;
            // console.warn("Disposing processor");
        }
            
        if (this._delayCanceller)
            this._delayCanceller.cancel!();

        return this._processPromise?.then(() =>
        {
            // console.warn("Processor disposed");
        }) || Promise.resolve().then(() =>
        {
            // console.warn("Processor disposed");
        });
    }

    protected abstract processEvent(workItem: WorkItem): Promise<void>;

    /**
     * Times the remote hop taken by the proxy processors, which otherwise have no visibility
     * at all. Shared here so the three of them cannot drift on attributes.
     */
    protected async timeProxyHop<T>(kind: NedaProxyKind, workItem: WorkItem, exec: () => Promise<T>): Promise<T>
    {
        const startedAt = performance.now();
        let errorType: string | null = null;

        try
        {
            return await exec();
        }
        catch (error: any)
        {
            errorType = errorTypeOf(error);
            throw error;
        }
        finally
        {
            const attributes: otelApi.Attributes = {
                [ATTR_MESSAGING_SYSTEM]: MESSAGING_SYSTEM,
                [ATTR_MESSAGING_DESTINATION_NAME]: workItem.topic,
                [ATTR_NEDA_PROXY_KIND]: kind
            };

            if (errorType !== null)
                attributes[ATTR_ERROR_TYPE] = errorType;

            instruments().proxyDuration.record((performance.now() - startedAt) / 1000, attributes);
        }
    }

    private async _process(): Promise<void>
    {
        const workItem = this._currentWorkItem!;
        
        const parentContext = otelApi.trace.setSpan(otelApi.context.active(), workItem.span);
        
        const tracer = otelApi.trace.getTracer("n-eda");
        const span = tracer.startSpan(`event.${workItem.event.name} process`, {
            kind: otelApi.SpanKind.CONSUMER,
            attributes: {
                [ATTR_MESSAGING_SYSTEM]: "n-eda",
                [ATTR_MESSAGING_OPERATION_TYPE]: "process",
                [ATTR_MESSAGING_DESTINATION_NAME]: `${workItem.topic}+++${workItem.partition}`,
                [ATTR_MESSAGING_DESTINATION_TEMPORARY]: false,
                [ATTR_MESSAGING_MESSAGE_ID]: workItem.event.id,
                [ATTR_MESSAGING_MESSAGE_CONVERSATION_ID]: workItem.event.partitionKey
            }
        }, parentContext);
        
        // otelApi.trace.setSpan(otelApi.context.active(), span);
        
        // Bare topic name plus consumer group, and no event name or partition: this is a
        // histogram, so every extra attribute is multiplied by the bucket count. Per event
        // type latency is what the `event.X process` span above is for.
        const metricAttributes: otelApi.Attributes = {
            [ATTR_MESSAGING_SYSTEM]: MESSAGING_SYSTEM,
            [ATTR_MESSAGING_OPERATION_NAME]: "process",
            [ATTR_MESSAGING_DESTINATION_NAME]: workItem.topic,
            [ATTR_MESSAGING_CONSUMER_GROUP_NAME]: this._manager.consumerGroupId ?? "UNKNOWN"
        };
        const eventMetricAttributes: otelApi.Attributes = {
            ...metricAttributes,
            [ATTR_NEDA_EVENT_NAME]: workItem.eventName
        };

        // Work is serialized per partition key, so a sustained wait here means head-of-line
        // blocking rather than a shortage of processors.
        instruments().schedulerWaitDuration
            .record((Date.now() - workItem.enqueuedAt) / 1000, metricAttributes);

        await otelApi.context.with(otelApi.trace.setSpan(otelApi.context.active(), span), async () =>
        {
            const maxProcessAttempts = 10;
            let numProcessAttempts = 0;
            const processStartedAt = performance.now();
            let terminalErrorType: string | null = null;
            let wasDisposed = false;
            try
            {
                while (numProcessAttempts < maxProcessAttempts)
                {
                    if (this._isDisposed)
                    {
                        wasDisposed = true;
                        workItem.deferred.reject(new ObjectDisposedException("Processor"));
                        return;
                    }

                    numProcessAttempts++;
                    const handlerStartedAt = performance.now();

                    try
                    {
                        await this.processEvent(workItem);

                        instruments().handlerDuration
                            .record((performance.now() - handlerStartedAt) / 1000, metricAttributes);
                        instruments().processAttempts
                            .add(1, { ...eventMetricAttributes, [ATTR_NEDA_OUTCOME]: "success" });

                        workItem.deferred.resolve();
                        return;
                    }
                    catch (error: any)
                    {
                        instruments().handlerDuration.record((performance.now() - handlerStartedAt) / 1000,
                            { ...metricAttributes, [ATTR_ERROR_TYPE]: errorTypeOf(error) });

                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        if (this._isDisposed)
                        {
                            wasDisposed = true;
                            workItem.deferred.reject(new ObjectDisposedException("Processor"));
                            return;
                        }

                        // if (numProcessAttempts > 8)
                        // {
                        //     await this.logger.logWarning(`Error in EventHandler while handling event of type '${workItem.eventName}' (ATTEMPT = ${numProcessAttempts}) with data ${JSON.stringify(workItem.event.serialize())}.`);
                        //     await this.logger.logWarning(error as Exception);
                        // }
                        
                        await this.logger.logWarning(`Error in EventHandler while handling event of type '${workItem.eventName}' (ATTEMPT = ${numProcessAttempts}) with data ${JSON.stringify(workItem.event.serialize())}.`);
                        await this.logger.logWarning(error);

                        if (numProcessAttempts >= maxProcessAttempts)
                            throw error;
                        else
                        {
                            instruments().processAttempts.add(1, {
                                ...eventMetricAttributes,
                                [ATTR_NEDA_OUTCOME]: "retry",
                                [ATTR_ERROR_TYPE]: errorTypeOf(error)
                            });

                            span.recordException(error as Error);
                            const seconds = (5 + numProcessAttempts) * numProcessAttempts; // [6, 14, 24, 36, 50, 66, 84, 104, 126]
                            span.addEvent("Waiting before retry", {
                                "delay": `${seconds}s`,
                                "attempt": numProcessAttempts
                            });
                            this._delayCanceller = {};
                            await Delay.seconds(seconds, this._delayCanceller);
                            this._delayCanceller = null;
                        }
                    }
                }
            }
            catch (error: any)
            {
                terminalErrorType = errorTypeOf(error);

                instruments().processAttempts.add(1, {
                    ...eventMetricAttributes,
                    [ATTR_NEDA_OUTCOME]: "exhausted",
                    [ATTR_ERROR_TYPE]: terminalErrorType
                });

                // There is no dead letter queue. The consumer swallows this rejection, marks
                // the event as tracked and advances the read index, so this counter is the
                // only signal that the event is permanently gone.
                instruments().eventDropped.add(1, {
                    ...eventMetricAttributes,
                    [ATTR_NEDA_DROP_REASON]: "process_failed",
                    [ATTR_ERROR_TYPE]: terminalErrorType
                });

                span.recordException(error as Error);
                span.addEvent(`Failed to process event of type '${workItem.eventName}'`, {
                    eventData: JSON.stringify(workItem.event.serialize())
                });
                const message = `Failed to process event of type '${workItem.eventName}' with data ${JSON.stringify(workItem.event.serialize())}`;
                span.setStatus({
                    code: otelApi.SpanStatusCode.ERROR,
                    message
                });
                await this._logger.logError(message);
                await this._logger.logError(error);
                workItem.deferred.reject(new ApplicationException(message, error as Exception));
            }
            finally
            {
                // Skipped when disposed: the event was neither processed nor dropped, it will
                // be re-read after restart, so recording it here would double count.
                if (!wasDisposed)
                {
                    instruments().processDuration.record((performance.now() - processStartedAt) / 1000,
                        terminalErrorType !== null
                            ? { ...metricAttributes, [ATTR_ERROR_TYPE]: terminalErrorType }
                            : metricAttributes);
                }

                span.end();
            }
        });
    }
}