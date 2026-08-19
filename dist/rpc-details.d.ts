/**
 * Connection details for proxying event processing to an HTTP RPC consumer.
 *
 * Contract: pass to `EdaManager.proxyToRpc(...)` on the process running the Redis consume loop; the
 * executing process hosts an `RpcServer` and calls `EdaManager.actAsRpcConsumer(...)`.
 *
 * Note: the transport is plain `http://` with no authentication on the `/process` endpoint. Full event
 * payloads cross the wire unencrypted — run it only on a trusted network.
 */
export interface RpcDetails {
    /** Hostname or IP of the RPC consumer. */
    readonly host: string;
    /** Port the RPC consumer listens on. */
    readonly port: number;
}
/**
 * The request body sent to an RPC consumer's `/process` endpoint.
 *
 * RULE: a custom RPC server must echo `eventName` and `eventId` back in its response body exactly.
 * `RpcProxyProcessor` detects success by comparing those two fields — a mismatch is treated as a failure,
 * so an endpoint that does not echo them burns all 10 retries on every event.
 *
 * Note: internal wire type; not exported from the barrel.
 */
export interface RpcModel {
    /** Id of the consumer that read the event, `{n-eda-<topic>-<partition>}`. */
    consumerId: string;
    /** Topic the event was read from. */
    topic: string;
    /** Partition the event was read from. */
    partition: number;
    /** The event's type name, used to look up the handler registration. */
    eventName: string;
    /** The serialized event, as an object (contrast `GrpcModel.payload`, which is a JSON string). */
    payload: object;
}
//# sourceMappingURL=rpc-details.d.ts.map