import { given } from "@nivinjoseph/n-defensive";
import { EdaManager } from "../eda-manager.js";
import { Processor } from "./processor.js";
import { WorkItem } from "./scheduler.js";
import { ApplicationException } from "@nivinjoseph/n-exception";


export class RpcProxyProcessor extends Processor
{
    private readonly _baseUrl: string;


    public constructor(manager: EdaManager)
    {
        super(manager);

        given(manager, "manager").ensure(t => t.rpcProxyEnabled, "RPC proxy not enabled");

        this._baseUrl = `http://${manager.rpcDetails!.host}:${manager.rpcDetails!.port}`;
    }


    protected async processEvent(workItem: WorkItem): Promise<void>
    {
        const response = await this.timeProxyHop("rpc", workItem, () => this._invokeRPC(workItem));

        const body: any = response.headers.get("content-type")?.includes("application/json")
            ? await response.json().catch(() => null)
            : null;

        if (response.status !== 200)
            throw new ApplicationException(
                `Error during invocation of RPC. Details => ${body ? JSON.stringify(body) : "Check logs for details."}`);

        if (body.eventName !== workItem.eventName || body.eventId !== workItem.eventId)
            throw new ApplicationException(
                `Error during invocation of RPC. Details => ${body ? JSON.stringify(body) : "Check logs for details."}`);
    }

    private _invokeRPC(workItem: WorkItem): Promise<Response>
    {
        return fetch(`${this._baseUrl}/process?event=${workItem.eventName}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                consumerId: workItem.consumerId,
                topic: workItem.topic,
                partition: workItem.partition,
                eventName: workItem.eventName,
                payload: workItem.event.serialize()
            }),
            signal: AbortSignal.timeout(60000)
        });
    }
}

