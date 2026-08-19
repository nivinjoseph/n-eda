import { EdaManager } from "../eda-manager.js";
import { Processor } from "./processor.js";
import { WorkItem } from "./scheduler.js";
/**
 * Forwards each work item to an HTTP RPC consumer instead of running a handler locally.
 *
 * Contract: success is confirmed by the response body echoing `eventName` and `eventId` exactly — the
 * consumer returns HTTP 200 even on failure, so the echo is the only signal. Requests abort after 60 seconds.
 *
 * Note: plaintext and unauthenticated.
 */
export declare class RpcProxyProcessor extends Processor {
    private readonly _baseUrl;
    constructor(manager: EdaManager);
    protected processEvent(workItem: WorkItem): Promise<void>;
    private _invokeRPC;
}
//# sourceMappingURL=rpc-proxy-processor.d.ts.map