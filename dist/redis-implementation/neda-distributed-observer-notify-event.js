import { __esDecorate, __runInitializers, __setFunctionName } from "tslib";
import { given } from "@nivinjoseph/n-defensive";
import { Serializable, serialize } from "@nivinjoseph/n-util";
let NedaDistributedObserverNotifyEvent = (() => {
    let _classDecorators = [serialize];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    let _classSuper = Serializable;
    let _instanceExtraInitializers = [];
    let _get_observerTypeName_decorators;
    let _get_observerId_decorators;
    let _get_observedEventId_decorators;
    let _get_observedEvent_decorators;
    let _get_id_decorators;
    let _get_name_decorators;
    var NedaDistributedObserverNotifyEvent = _classThis = class extends _classSuper {
        get observerTypeName() { return this._observerTypeName; }
        get observerId() { return this._observerId; }
        get observedEventId() { return this._observedEventId; }
        get observedEvent() { return this._observedEvent; }
        get id() { return `${this.observerTypeName}.${this.observerId}.${this.observedEventId}`; }
        get name() { return NedaDistributedObserverNotifyEvent.getTypeName(); }
        get partitionKey() { return this.observerId; }
        get refId() { return this.observerId; }
        get refType() { return this.observerTypeName; }
        constructor(data) {
            super(data);
            this._observerTypeName = (__runInitializers(this, _instanceExtraInitializers), void 0);
            const { observerTypeName, observerId, observedEventId, observedEvent } = data;
            given(observerTypeName, "observerTypeName").ensureHasValue().ensureIsString();
            this._observerTypeName = observerTypeName;
            given(observerId, "observerId").ensureHasValue().ensureIsString();
            this._observerId = observerId;
            given(observedEventId, "observedEventId").ensureHasValue().ensureIsString();
            this._observedEventId = observedEventId;
            given(observedEvent, "observedEvent").ensureHasValue().ensureIsObject();
            this._observedEvent = observedEvent;
        }
    };
    __setFunctionName(_classThis, "NedaDistributedObserverNotifyEvent");
    (() => {
        var _a;
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create((_a = _classSuper[Symbol.metadata]) !== null && _a !== void 0 ? _a : null) : void 0;
        _get_observerTypeName_decorators = [serialize];
        _get_observerId_decorators = [serialize];
        _get_observedEventId_decorators = [serialize];
        _get_observedEvent_decorators = [serialize];
        _get_id_decorators = [serialize];
        _get_name_decorators = [serialize];
        __esDecorate(_classThis, null, _get_observerTypeName_decorators, { kind: "getter", name: "observerTypeName", static: false, private: false, access: { has: obj => "observerTypeName" in obj, get: obj => obj.observerTypeName }, metadata: _metadata }, null, _instanceExtraInitializers);
        __esDecorate(_classThis, null, _get_observerId_decorators, { kind: "getter", name: "observerId", static: false, private: false, access: { has: obj => "observerId" in obj, get: obj => obj.observerId }, metadata: _metadata }, null, _instanceExtraInitializers);
        __esDecorate(_classThis, null, _get_observedEventId_decorators, { kind: "getter", name: "observedEventId", static: false, private: false, access: { has: obj => "observedEventId" in obj, get: obj => obj.observedEventId }, metadata: _metadata }, null, _instanceExtraInitializers);
        __esDecorate(_classThis, null, _get_observedEvent_decorators, { kind: "getter", name: "observedEvent", static: false, private: false, access: { has: obj => "observedEvent" in obj, get: obj => obj.observedEvent }, metadata: _metadata }, null, _instanceExtraInitializers);
        __esDecorate(_classThis, null, _get_id_decorators, { kind: "getter", name: "id", static: false, private: false, access: { has: obj => "id" in obj, get: obj => obj.id }, metadata: _metadata }, null, _instanceExtraInitializers);
        __esDecorate(_classThis, null, _get_name_decorators, { kind: "getter", name: "name", static: false, private: false, access: { has: obj => "name" in obj, get: obj => obj.name }, metadata: _metadata }, null, _instanceExtraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        NedaDistributedObserverNotifyEvent = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return NedaDistributedObserverNotifyEvent = _classThis;
})();
export { NedaDistributedObserverNotifyEvent };
//# sourceMappingURL=neda-distributed-observer-notify-event.js.map