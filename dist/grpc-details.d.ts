/**
 * Connection details for proxying event processing to a gRPC consumer.
 *
 * Contract: pass to `EdaManager.proxyToGrpc(...)` on the process running the Redis consume loop; the
 * executing process hosts a `GrpcServer` and calls `EdaManager.actAsGrpcConsumer(...)`. The `.proto`
 * definitions ship with this package — you never supply one.
 *
 * Note: the transport is insecure (`createInsecure()`); {@link GrpcDetails.isSecure} is accepted and
 * ignored. There is also no per-call deadline on gRPC, unlike the RPC transport's 60 s timeout.
 */
export interface GrpcDetails {
    /** Hostname or IP of the gRPC consumer. */
    readonly host: string;
    /** Port the gRPC consumer listens on. */
    readonly port: number;
    /**
     * Intended to select TLS credentials.
     *
     * RULE: currently **ignored** — the TLS branch is commented out and connections are always insecure.
     * Setting this to `true` does not encrypt anything.
     */
    readonly isSecure?: boolean;
    /** Size of the round-robin client pool. Defaults to 50; a value of 0 or less is coerced to 50. */
    readonly connectionPoolSize?: number;
}
/**
 * The request message sent to a gRPC consumer.
 *
 * Note: internal wire type; not exported from the barrel.
 */
export interface GrpcModel {
    /** Id of the consumer that read the event, `{n-eda-<topic>-<partition>}`. */
    consumerId: string;
    /** Topic the event was read from. */
    topic: string;
    /** Partition the event was read from. */
    partition: number;
    /** The event's type name, used to look up the handler registration. */
    eventName: string;
    /** The serialized event as a JSON **string** (contrast `RpcModel.payload`, which is an object). */
    payload: string;
}
//# sourceMappingURL=grpc-details.d.ts.map