import { __esDecorate, __runInitializers } from "tslib";
import { given } from "@nivinjoseph/n-defensive";
import { Serializable, serialize } from "@nivinjoseph/n-util";
/**
 * A framework control event that clears consumers' deduplication state.
 *
 * Contract: publish it to a topic like any other event. `RedisEventBus` special-cases it and fans it out to
 * **every** partition of that topic; each consumer that receives it deletes its tracked-keys list in Redis
 * and empties the in-memory equivalent, then carries on.
 *
 * Note: use this when you have deliberately rewound a read index and need previously-seen events to be
 * processed again — without it, the last 1000 event ids per partition would be suppressed as duplicates.
 * It does not rewind offsets itself.
 *
 * @example
 * ```typescript
 * await eventBus.publish("orders", new NedaClearTrackedKeysEvent({ id: "clear-1" }));
 * ```
 */
let NedaClearTrackedKeysEvent = (() => {
    let _classDecorators = [serialize("Neda")];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    let _classSuper = Serializable;
    let _instanceExtraInitializers = [];
    let _get_id_decorators;
    let _get_name_decorators;
    var NedaClearTrackedKeysEvent = class extends _classSuper {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _get_id_decorators = [serialize];
            _get_name_decorators = [serialize];
            __esDecorate(this, null, _get_id_decorators, { kind: "getter", name: "id", static: false, private: false, access: { has: obj => "id" in obj, get: obj => obj.id }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _get_name_decorators, { kind: "getter", name: "name", static: false, private: false, access: { has: obj => "name" in obj, get: obj => obj.name }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            NedaClearTrackedKeysEvent = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        _id = __runInitializers(this, _instanceExtraInitializers);
        get id() { return this._id; }
        get name() { return NedaClearTrackedKeysEvent.getTypeName(); }
        /** The type name — this event is fanned out to every partition, so the value is only a placeholder. */
        get partitionKey() { return this.name; }
        /** Same as {@link NedaClearTrackedKeysEvent.id}; unused, as this event is not observable. */
        get refId() { return this.id; }
        /** Always `"neda"` — this is a framework event, not a domain one. */
        get refType() { return "neda"; }
        /**
         * @param data - carries the event `id`, which is only used for logging and dedupe bookkeeping
         * @throws if `id` is missing or not a string
         */
        constructor(data) {
            super(data);
            const { id } = data;
            given(id, "id").ensureHasValue().ensureIsString();
            this._id = id;
        }
    };
    return NedaClearTrackedKeysEvent = _classThis;
})();
export { NedaClearTrackedKeysEvent };
//# sourceMappingURL=neda-clear-tracked-keys-event.js.map