import { ServiceLocator } from "@nivinjoseph/n-ject";
import { EdaEvent } from "../eda-event";
import { EdaManager } from "../eda-manager";
export declare class AwsLambdaEventHandler {
    private readonly _nedaDistributedObserverNotifyEventName;
    private _manager;
    private _logger;
    initialize(manager: EdaManager): void;
    process(event: object, context: Record<string, any>): Promise<{
        eventName: string;
        eventId: string;
    } | {
        statusCode: number;
        error: string;
    }>;
    protected onEventReceived(scope: ServiceLocator, topic: string, event: EdaEvent): void;
    private _process;
    private _getErrorMessage;
}
