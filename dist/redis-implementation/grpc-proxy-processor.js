import { given } from "@nivinjoseph/n-defensive";
import { ApplicationException } from "@nivinjoseph/n-exception";
import { Processor } from "./processor.js";
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
export class GrpcProxyProcessor extends Processor {
    _grpcClient;
    constructor(manager, grpcClientFactory) {
        super(manager);
        given(manager, "manager").ensure(t => t.grpcProxyEnabled, "GRPC proxy not enabled");
        given(grpcClientFactory, "grpcClientFactory").ensureHasValue().ensureIsType(GrpcClientFactory);
        this._grpcClient = grpcClientFactory.create();
    }
    async processEvent(workItem) {
        const response = await this._grpcClient.process(workItem);
        const { eventName, eventId } = response;
        if (eventName !== workItem.eventName || eventId !== workItem.eventId)
            throw new ApplicationException(
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            `Error during invocation of GRPC. Details => ${response ? JSON.stringify(response) : "Check logs for details."}`);
    }
}
//# sourceMappingURL=grpc-proxy-processor.js.map