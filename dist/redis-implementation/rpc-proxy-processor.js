import { given } from "@nivinjoseph/n-defensive";
import { Processor } from "./processor.js";
import { ApplicationException } from "@nivinjoseph/n-exception";
import * as Axios from "axios";
export class RpcProxyProcessor extends Processor {
    constructor(manager) {
        super(manager);
        given(manager, "manager").ensure(t => t.rpcProxyEnabled, "RPC proxy not enabled");
        this._rpcClient = Axios.default.create({
            timeout: 60000,
            baseURL: `http://${manager.rpcDetails.host}:${manager.rpcDetails.port}`
        });
    }
    async processEvent(workItem) {
        const response = await this._invokeRPC(workItem);
        if (response.status !== 200)
            throw new ApplicationException(`Error during invocation of RPC. Details => ${response.data ? JSON.stringify(response.data) : "Check logs for details."}`);
        const result = response.data;
        if (result.eventName !== workItem.eventName || result.eventId !== workItem.eventId)
            throw new ApplicationException(`Error during invocation of RPC. Details => ${result ? JSON.stringify(result) : "Check logs for details."}`);
    }
    _invokeRPC(workItem) {
        return this._rpcClient.post("/process" + `?event=${workItem.eventName}`, {
            consumerId: workItem.consumerId,
            topic: workItem.topic,
            partition: workItem.partition,
            eventName: workItem.eventName,
            payload: workItem.event.serialize()
        });
    }
}
//# sourceMappingURL=rpc-proxy-processor.js.map