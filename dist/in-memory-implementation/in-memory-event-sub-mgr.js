// import { EventSubMgr } from "../event-sub-mgr";
// import { ServiceLocator } from "@nivinjoseph/n-ject";
// import { given } from "@nivinjoseph/n-defensive";
// import { BackgroundProcessor, Make, Delay } from "@nivinjoseph/n-util";
// import { InMemoryEventBus } from "./in-memory-event-bus";
// import { EdaEventHandler } from "../eda-event-handler";
// import { EdaEvent } from "../eda-event";
// import { Logger } from "@nivinjoseph/n-log";
// import { ObjectDisposedException, ApplicationException } from "@nivinjoseph/n-exception";
// import { EdaManager } from "../eda-manager";
// import { EventRegistration } from "../event-registration";
export {};
// // public
// export class InMemoryEventSubMgr implements EventSubMgr
// {
//     private readonly _consumers = new Map<string, Array<BackgroundProcessor>>();
//     private _isDisposed = false;
//     private _manager: EdaManager = null as any;
//     private _logger: Logger = null as any;
//     private _isConsuming = false;
//     public initialize(manager: EdaManager): void
//     {
//         if (this._isDisposed)
//             throw new ObjectDisposedException(this);
//         given(manager, "manager").ensureHasValue().ensureIsObject().ensureIsType(EdaManager);
//         given(this, "this").ensure(t => !t._manager, "already initialized");
//         this._manager = manager;
//         this._logger = this._manager.serviceLocator.resolve<Logger>("Logger");
//     }
//     public async consume(): Promise<void>
//     {
//         if (this._isDisposed)
//             throw new ObjectDisposedException(this);
//         given(this, "this").ensure(t => !!t._manager, "not initialized");
//         if (!this._isConsuming)    
//         {
//             this._isConsuming = true;
//             this._manager.topics.forEach(topic =>
//             {
//                 const processors = new Array<BackgroundProcessor>();
//                 Make.loop(() => processors.push(new BackgroundProcessor((e) => this._logger.logError(e as any))), topic.numPartitions);
//                 this._consumers.set(topic.name, processors);
//             });
//             const inMemoryEventBus = this._manager.serviceLocator.resolve<InMemoryEventBus>(EdaManager.eventBusKey);
//             if (!(inMemoryEventBus instanceof InMemoryEventBus))
//                 throw new ApplicationException("InMemoryEventSubMgr can only work with InMemoryEventBus.");
//             inMemoryEventBus.onPublish((topic: string, partition: number, event: EdaEvent) =>
//             {
//                 if (this._isDisposed)
//                     throw new ObjectDisposedException(this);
//                 const topicProcessors = this._consumers.get(topic) as ReadonlyArray<BackgroundProcessor>;
//                 const processor = topicProcessors[partition];
//                 const eventRegistration = this._manager.eventMap.get(event.name) as EventRegistration;
//                 const scope = this._manager.serviceLocator.createScope();
//                 (<any>event).$scope = scope;
//                 try 
//                 {
//                     this.onEventReceived(scope, topic, event);
//                     const handler = scope.resolve<EdaEventHandler<EdaEvent>>(eventRegistration.eventHandlerTypeName);
//                     processor.processAction(async () =>
//                     {
//                         try 
//                         {
//                             await handler.handle(event);
//                         }
//                         finally
//                         {
//                             await scope.dispose();
//                         }
//                     });
//                 }
//                 catch (error)
//                 {
//                     this._logger.logError(error)
//                         .then(() => scope.dispose())
//                         .catch(() => { });
//                 }
//             });
//         }
//         while (!this._isDisposed)
//         {
//             await Delay.seconds(2);
//         }
//     }
//     public async dispose(): Promise<void>
//     {
//         if (this._isDisposed)
//             return;
//         this._isDisposed = true;
//         await Promise.all([...this._consumers.values()].reduce((acc, processors) =>
//         {
//             acc.push(...processors.map(t => t.dispose(false)));
//             return acc;
//         }, new Array<Promise<void>>()));
//     }
//     protected onEventReceived(scope: ServiceLocator, topic: string, event: EdaEvent): void
//     {
//         given(scope, "scope").ensureHasValue().ensureIsObject();
//         given(topic, "topic").ensureHasValue().ensureIsString();
//         given(event, "event").ensureHasValue().ensureIsObject();
//     }
// }
//# sourceMappingURL=in-memory-event-sub-mgr.js.map