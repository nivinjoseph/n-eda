import { EdaManager } from "../eda-manager.js";
import { Processor } from "./processor.js";
import { WorkItem } from "./scheduler.js";
export declare class AwsLambdaProxyProcessor extends Processor {
    private readonly _lambda;
    constructor(manager: EdaManager);
    protected processEvent(workItem: WorkItem): Promise<void>;
    private _invokeLambda;
}
//# sourceMappingURL=aws-lambda-proxy-processor.d.ts.map