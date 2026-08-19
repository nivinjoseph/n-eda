import { EdaManager } from "../eda-manager.js";
import { WorkItem } from "./scheduler.js";
/**
 * Builds and hands out gRPC clients from a fixed round-robin pool.
 *
 * Contract: pool size comes from `GrpcDetails.connectionPoolSize`, defaulting to 50 (a value of 0 or less is
 * coerced to the default). Credentials are always insecure — the TLS branch is commented out and
 * `GrpcDetails.isSecure` is ignored.
 *
 * Note: the `.proto` files are resolved from `src/`, not `dist/`, so gRPC only works when the published
 * package still ships its sources. See `docs/known-issues.md`.
 */
export declare class GrpcClientFactory {
    private readonly _manager;
    private readonly _logger;
    private readonly _endpoint;
    private readonly _serviceDef;
    private readonly _creds;
    private readonly _clients;
    private _roundRobin;
    constructor(manager: EdaManager);
    create(): GrpcClient;
}
/**
 * A pooled gRPC client together with the bookkeeping used to decide when to recycle it.
 *
 * Note: internal. The staleness and overuse thresholds are currently inert — the recycling intervals that
 * consumed them are commented out.
 */
export interface GrpcClient {
    process(workItem: WorkItem): Promise<{
        eventName: string;
        eventId: string;
    }>;
}
//# sourceMappingURL=grpc-client-factory.d.ts.map