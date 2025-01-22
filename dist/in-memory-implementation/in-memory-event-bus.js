// import { EventBus } from "../event-bus";
// import { EdaEvent } from "../eda-event";
// import { given } from "@nivinjoseph/n-defensive";
// import { ObjectDisposedException } from "@nivinjoseph/n-exception";
// import { EdaManager } from "../eda-manager";
export {};
// // public
// export class InMemoryEventBus implements EventBus
// {
//     private _isDisposed = false;
//     private _onPublish: (topic: string, partition: number, event: EdaEvent) => void = null as any;
//     private _manager: EdaManager = null as any;
//     public initialize(manager: EdaManager): void
//     {
//         given(manager, "manager").ensureHasValue().ensureIsObject().ensureIsType(EdaManager);
//         given(this, "this").ensure(t => !t._manager, "already initialized");
//         this._manager = manager;
//     }
//     public async publish(topic: string, event: EdaEvent): Promise<void>
//     {
//         if (this._isDisposed)
//             throw new ObjectDisposedException(this);
//         given(this, "this")
//             .ensure(t => !!t._manager, "not initialized")
//             .ensure(t => !!t._onPublish, "onPublish callback has not been registered");
//         given(topic, "topic").ensureHasValue().ensureIsString()
//             .ensure(t => this._manager.topics.some(u => u.name === t));
//         given(event, "event").ensureHasValue().ensureIsObject()
//             .ensureHasStructure({
//                 id: "string",
//                 name: "string",
//             });  
//         if (!this._manager.eventMap.has(event.name))
//             return;
//         this._onPublish(topic, this._manager.mapToPartition(topic, event), event);
//     }
//     public onPublish(callback: (topic: string, partition: number, event: EdaEvent) => void): void
//     {
//         if (this._isDisposed)
//             throw new ObjectDisposedException(this);
//         given(callback, "callback").ensureHasValue().ensureIsFunction();
//         given(this, "this").ensure(t => !t._onPublish, "setting onPublish callback more than once");
//         this._onPublish = callback;
//     }
//     public async dispose(): Promise<void>
//     {
//         if (this._isDisposed)
//             return;
//         this._isDisposed = true;
//         this._onPublish = null as any;
//     }
// }
//# sourceMappingURL=in-memory-event-bus.js.map