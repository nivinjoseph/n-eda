export interface RpcDetails {
    readonly host: string;
    readonly port: number;
}
export interface RpcModel {
    consumerId: string;
    topic: string;
    partition: number;
    eventName: string;
    payload: object;
}
//# sourceMappingURL=rpc-details.d.ts.map