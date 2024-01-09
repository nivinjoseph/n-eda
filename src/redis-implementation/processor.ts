import { given } from "@nivinjoseph/n-defensive";
import { ApplicationException, Exception, InvalidOperationException, ObjectDisposedException } from "@nivinjoseph/n-exception";
import { Logger } from "@nivinjoseph/n-log";
import { Delay, DelayCanceller, Disposable, Observable, Observer } from "@nivinjoseph/n-util";
import { EdaManager } from "../eda-manager.js";
// import { ConsumerTracer } from "../event-handler-tracer";
import * as otelApi from "@opentelemetry/api";
import * as semCon from "@opentelemetry/semantic-conventions";
import { WorkItem } from "./scheduler.js";


export abstract class Processor implements Disposable
{
    private readonly _manager: EdaManager;
    // private readonly _consumerTracer: ConsumerTracer | null;
    // private readonly _hasConsumerTracer: boolean;
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

        // this._consumerTracer = this._manager.consumerTracer;
        // this._hasConsumerTracer = this._consumerTracer != null;

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

    private async _process(): Promise<void>
    {
        const workItem = this._currentWorkItem!;
        
        const parentContext = otelApi.trace.setSpan(otelApi.context.active(), workItem.span);
        
        const tracer = otelApi.trace.getTracer("n-eda");
        const span = tracer.startSpan(`event.${workItem.event.name} process`, {
            kind: otelApi.SpanKind.CONSUMER,
            attributes: {
                [semCon.SemanticAttributes.MESSAGING_SYSTEM]: "n-eda",
                [semCon.SemanticAttributes.MESSAGING_OPERATION]: "process",
                [semCon.SemanticAttributes.MESSAGING_DESTINATION]: `${workItem.topic}+++${workItem.partition}`,
                [semCon.SemanticAttributes.MESSAGING_DESTINATION_KIND]: "topic",
                [semCon.SemanticAttributes.MESSAGING_TEMP_DESTINATION]: false,
                [semCon.SemanticAttributes.MESSAGING_PROTOCOL]: "NEDA",
                [semCon.SemanticAttributes.MESSAGE_ID]: workItem.event.id,
                [semCon.SemanticAttributes.MESSAGING_CONVERSATION_ID]: workItem.event.partitionKey
            }
        }, parentContext);
        
        // otelApi.trace.setSpan(otelApi.context.active(), span);
        
        await otelApi.context.with(otelApi.trace.setSpan(otelApi.context.active(), span), async () =>
        { 
            const maxProcessAttempts = 10;
            let numProcessAttempts = 0;
            try 
            {
                while (numProcessAttempts < maxProcessAttempts)
                {
                    if (this._isDisposed)
                    {
                        workItem.deferred.reject(new ObjectDisposedException("Processor"));
                        return;
                    }

                    numProcessAttempts++;

                    try 
                    {
                        // await this._logger.logInfo(`Processing event ${workItem.eventName} with id ${workItem.eventId}`);

                        // if (this._hasConsumerTracer)
                        //     await this._consumerTracer!({
                        //         topic: workItem.topic,
                        //         partition: workItem.partition,
                        //         partitionKey: workItem.partitionKey,
                        //         eventName: workItem.eventName,
                        //         eventId: workItem.eventId
                        //     }, () => this.processEvent(workItem));
                        // else
                        //     await this.processEvent(workItem);

                        await this.processEvent(workItem);
                        workItem.deferred.resolve();
                        return;
                    }
                    catch (error: any)
                    {
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        if (this._isDisposed)
                        {
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
                span.end();
            } 
        });
    }
}