import { EdaManager } from "../eda-manager.js";
import { Processor } from "./processor.js";
import { WorkItem } from "./scheduler.js";
import { GrpcClientFactory } from "./grpc-client-factory.js";
/**
 * Forwards each work item to a gRPC consumer instead of running a handler locally, using a pooled client from
 * `GrpcClientFactory`.
 *
 * Contract: success is confirmed by the response echoing `eventName` and `eventId`.
 *
 * Note: connections are insecure, and there is **no per-call deadline** — unlike the RPC processor's 60 s
 * timeout, a hung gRPC consumer blocks the work item indefinitely.
 */
export declare class GrpcProxyProcessor extends Processor {
    private readonly _grpcClient;
    constructor(manager: EdaManager, grpcClientFactory: GrpcClientFactory);
    protected processEvent(workItem: WorkItem): Promise<void>;
}
//# sourceMappingURL=grpc-proxy-processor.d.ts.map