import { given } from "@nivinjoseph/n-defensive";
import { ApplicationException } from "@nivinjoseph/n-exception";
import { InvokeCommand, Lambda } from "@aws-sdk/client-lambda";
import { Processor } from "./processor.js";
export class AwsLambdaProxyProcessor extends Processor {
    constructor(manager) {
        super(manager);
        given(manager, "manager").ensure(t => t.awsLambdaProxyEnabled, "AWS Lambda proxy not enabled");
        this._lambda = new Lambda({
            // signatureVersion: "v4",
            region: manager.awsLambdaDetails.region,
            credentials: {
                accessKeyId: manager.awsLambdaDetails.credentials.accessKeyId,
                secretAccessKey: manager.awsLambdaDetails.credentials.accessKeySecret
            }
        });
    }
    async processEvent(workItem) {
        var _a, _b, _c, _d;
        const response = await this._invokeLambda(workItem);
        const result = response.Payload ? JSON.parse(response.Payload.transformToString()) : null;
        if (result != null && result.error)
            throw new ApplicationException("Error during invocation of AWS Lambda.", result.error);
        if (response.StatusCode !== 200)
            throw new ApplicationException(`Error during invocation of AWS Lambda. Details => ${(_b = (_a = response.LogResult) === null || _a === void 0 ? void 0 : _a.base64Decode()) !== null && _b !== void 0 ? _b : "Check CloudWatch logs for details."}`);
        if (result.eventName !== workItem.eventName || result.eventId !== workItem.eventId)
            throw new ApplicationException(`Error during invocation of AWS Lambda. Details => ${(_d = (_c = response.LogResult) === null || _c === void 0 ? void 0 : _c.base64Decode()) !== null && _d !== void 0 ? _d : "Check CloudWatch logs for details."}`);
    }
    _invokeLambda(workItem) {
        return this._lambda.send(new InvokeCommand({
            FunctionName: this.manager.awsLambdaDetails.funcName,
            InvocationType: "RequestResponse",
            LogType: "Tail",
            ClientContext: JSON.stringify({
                consumerId: workItem.consumerId,
                topic: workItem.topic,
                partition: workItem.partition,
                eventName: workItem.eventName
            }).base64Encode(),
            Payload: JSON.stringify(workItem.event.serialize())
        }));
    }
}
//# sourceMappingURL=aws-lambda-proxy-processor.js.map