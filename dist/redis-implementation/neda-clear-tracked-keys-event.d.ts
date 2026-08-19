import { Serializable } from "@nivinjoseph/n-util";
import { EdaEvent } from "../eda-event.js";
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
export declare class NedaClearTrackedKeysEvent extends Serializable implements EdaEvent {
    private readonly _id;
    get id(): string;
    get name(): string;
    /** The type name — this event is fanned out to every partition, so the value is only a placeholder. */
    get partitionKey(): string;
    /** Same as {@link NedaClearTrackedKeysEvent.id}; unused, as this event is not observable. */
    get refId(): string;
    /** Always `"neda"` — this is a framework event, not a domain one. */
    get refType(): string;
    /**
     * @param data - carries the event `id`, which is only used for logging and dedupe bookkeeping
     * @throws if `id` is missing or not a string
     */
    constructor(data: Pick<NedaClearTrackedKeysEvent, "id">);
}
//# sourceMappingURL=neda-clear-tracked-keys-event.d.ts.map