import { ClassDefinition, Serializable } from "@nivinjoseph/n-util";
export interface EdaEvent extends Serializable {
    get id(): string;
    get name(): string;
    get partitionKey(): string;
    get refId(): string;
    get refType(): string;
}
export type EdaEventClass<TEvent extends EdaEvent> = ClassDefinition<TEvent>;
//# sourceMappingURL=eda-event.d.ts.map