import { __esDecorate, __runInitializers, __setFunctionName } from "tslib";
import { given } from "@nivinjoseph/n-defensive";
import { Serializable, serialize } from "@nivinjoseph/n-util";
let NedaClearTrackedKeysEvent = (() => {
    let _classDecorators = [serialize];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    let _classSuper = Serializable;
    let _instanceExtraInitializers = [];
    let _get_id_decorators;
    let _get_name_decorators;
    var NedaClearTrackedKeysEvent = _classThis = class extends _classSuper {
        get id() { return this._id; }
        get name() { return NedaClearTrackedKeysEvent.getTypeName(); }
        get partitionKey() { return this.name; }
        get refId() { return this.id; }
        get refType() { return "neda"; }
        constructor(data) {
            super(data);
            this._id = (__runInitializers(this, _instanceExtraInitializers), void 0);
            const { id } = data;
            given(id, "id").ensureHasValue().ensureIsString();
            this._id = id;
        }
    };
    __setFunctionName(_classThis, "NedaClearTrackedKeysEvent");
    (() => {
        var _a;
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create((_a = _classSuper[Symbol.metadata]) !== null && _a !== void 0 ? _a : null) : void 0;
        _get_id_decorators = [serialize];
        _get_name_decorators = [serialize];
        __esDecorate(_classThis, null, _get_id_decorators, { kind: "getter", name: "id", static: false, private: false, access: { has: obj => "id" in obj, get: obj => obj.id }, metadata: _metadata }, null, _instanceExtraInitializers);
        __esDecorate(_classThis, null, _get_name_decorators, { kind: "getter", name: "name", static: false, private: false, access: { has: obj => "name" in obj, get: obj => obj.name }, metadata: _metadata }, null, _instanceExtraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        NedaClearTrackedKeysEvent = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return NedaClearTrackedKeysEvent = _classThis;
})();
export { NedaClearTrackedKeysEvent };
//# sourceMappingURL=neda-clear-tracked-keys-event.js.map