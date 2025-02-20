import { EdaManager } from "../eda-manager.js";
import { WorkItem } from "./scheduler.js";
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
export interface GrpcClient {
    process(workItem: WorkItem): Promise<{
        eventName: string;
        eventId: string;
    }>;
}
//# sourceMappingURL=grpc-client-factory.d.ts.map