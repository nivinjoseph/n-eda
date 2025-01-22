import { given } from "@nivinjoseph/n-defensive";
import { ApplicationException } from "@nivinjoseph/n-exception";
import { InvokeCommand, InvokeCommandOutput, Lambda } from "@aws-sdk/client-lambda";
import { EdaManager } from "../eda-manager.js";
import { Processor } from "./processor.js";
import { WorkItem } from "./scheduler.js";


export class AwsLambdaProxyProcessor extends Processor
{
    private readonly _lambda: Lambda;


    public constructor(manager: EdaManager)
    {
        super(manager);

        given(manager, "manager").ensure(t => t.awsLambdaProxyEnabled, "AWS Lambda proxy not enabled");

        this._lambda = new Lambda({
            // signatureVersion: "v4",
            region: manager.awsLambdaDetails!.region,
            credentials: {
                accessKeyId: manager.awsLambdaDetails!.credentials.accessKeyId,
                secretAccessKey: manager.awsLambdaDetails!.credentials.accessKeySecret
            }
        });
    }


    protected async processEvent(workItem: WorkItem): Promise<void>
    {
        const response = await this._invokeLambda(workItem);

        const result = response.Payload ? JSON.parse(response.Payload.transformToString()) : null;

        if (result != null && result.error)
            throw new ApplicationException("Error during invocation of AWS Lambda.", result.error);

        if (response.StatusCode !== 200)
            throw new ApplicationException(
                `Error during invocation of AWS Lambda. Details => ${response.LogResult?.base64Decode() ?? "Check CloudWatch logs for details."}`);

        if (result.eventName !== workItem.eventName || result.eventId !== workItem.eventId)
            throw new ApplicationException(
                `Error during invocation of AWS Lambda. Details => ${response.LogResult?.base64Decode() ?? "Check CloudWatch logs for details."}`);
    }

    private _invokeLambda(workItem: WorkItem): Promise<InvokeCommandOutput>
    {
        return this._lambda.send(new InvokeCommand({
            FunctionName: this.manager.awsLambdaDetails!.funcName,
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