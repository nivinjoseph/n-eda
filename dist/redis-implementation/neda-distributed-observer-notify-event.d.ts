import { Serializable } from "@nivinjoseph/n-util";
import { EdaEvent } from "../eda-event.js";
export declare class NedaDistributedObserverNotifyEvent extends Serializable implements EdaEvent {
    private readonly _observerTypeName;
    private readonly _observerId;
    private readonly _observedEventId;
    private readonly _observedEvent;
    get observerTypeName(): string;
    get observerId(): string;
    get observedEventId(): string;
    get observedEvent(): EdaEvent;
    get id(): string;
    get name(): string;
    get partitionKey(): string;
    get refId(): string;
    get refType(): string;
    constructor(data: Pick<NedaDistributedObserverNotifyEvent, "observerTypeName" | "observerId" | "observedEventId" | "observedEvent">);
}
//# sourceMappingURL=neda-distributed-observer-notify-event.d.ts.map