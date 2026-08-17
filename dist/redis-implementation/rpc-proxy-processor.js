import { given } from "@nivinjoseph/n-defensive";
import { Processor } from "./processor.js";
import { ApplicationException } from "@nivinjoseph/n-exception";
export class RpcProxyProcessor extends Processor {
    _baseUrl;
    constructor(manager) {
        super(manager);
        given(manager, "manager").ensure(t => t.rpcProxyEnabled, "RPC proxy not enabled");
        this._baseUrl = `http://${manager.rpcDetails.host}:${manager.rpcDetails.port}`;
    }
    async processEvent(workItem) {
        const response = await this.timeProxyHop("rpc", workItem, () => this._invokeRPC(workItem));
        const body = response.headers.get("content-type")?.includes("application/json")
            ? await response.json().catch(() => null)
            : null;
        if (response.status !== 200)
            throw new ApplicationException(`Error during invocation of RPC. Details => ${body ? JSON.stringify(body) : "Check logs for details."}`);
        if (body.eventName !== workItem.eventName || body.eventId !== workItem.eventId)
            throw new ApplicationException(`Error during invocation of RPC. Details => ${body ? JSON.stringify(body) : "Check logs for details."}`);
    }
    _invokeRPC(workItem) {
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
//# sourceMappingURL=rpc-proxy-processor.js.map