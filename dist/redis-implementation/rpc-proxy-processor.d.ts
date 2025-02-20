import { EdaManager } from "../eda-manager.js";
import { Processor } from "./processor.js";
import { WorkItem } from "./scheduler.js";
export declare class RpcProxyProcessor extends Processor {
    private readonly _rpcClient;
    constructor(manager: EdaManager);
    protected processEvent(workItem: WorkItem): Promise<void>;
    private _invokeRPC;
}
//# sourceMappingURL=rpc-proxy-processor.d.ts.map