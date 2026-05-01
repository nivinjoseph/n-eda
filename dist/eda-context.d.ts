export interface EdaContext {
    get topic(): string;
}
export declare class DefaultEdaContext implements EdaContext {
    private _topic;
    get topic(): string;
    set topic(value: string);
}
//# sourceMappingURL=eda-context.d.ts.map