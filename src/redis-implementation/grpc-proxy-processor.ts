import { given } from "@nivinjoseph/n-defensive";
import { ApplicationException } from "@nivinjoseph/n-exception";
import { EdaManager } from "../eda-manager.js";
import { Processor } from "./processor.js";
import { WorkItem } from "./scheduler.js";
import { GrpcClient, GrpcClientFactory } from "./grpc-client-factory.js";


export class GrpcProxyProcessor extends Processor
{
    private readonly _grpcClient: GrpcClient;


    public constructor(manager: EdaManager, grpcClientFactory: GrpcClientFactory)
    {
        super(manager);

        given(manager, "manager").ensure(t => t.grpcProxyEnabled, "GRPC proxy not enabled");

        given(grpcClientFactory, "grpcClientFactory").ensureHasValue().ensureIsType(GrpcClientFactory);
        this._grpcClient = grpcClientFactory.create();
    }


    protected async processEvent(workItem: WorkItem): Promise<void>
    {
        const response = await this._grpcClient.process(workItem);

        const { eventName, eventId } = response;

        if (eventName !== workItem.eventName || eventId !== workItem.eventId)
            throw new ApplicationException(
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                `Error during invocation of GRPC. Details => ${response ? JSON.stringify(response) : "Check logs for details."}`);
    }
}

