import { EdaManager } from "../eda-manager.js";
import { Processor } from "./processor.js";
import { WorkItem } from "./scheduler.js";
import { GrpcClientFactory } from "./grpc-client-factory.js";
export declare class GrpcProxyProcessor extends Processor {
    private readonly _grpcClient;
    constructor(manager: EdaManager, grpcClientFactory: GrpcClientFactory);
    protected processEvent(workItem: WorkItem): Promise<void>;
}
//# sourceMappingURL=grpc-proxy-processor.d.ts.map