import { EdaEvent } from "./eda-event.js";
import { Disposable } from "@nivinjoseph/n-util";
import { EdaManager } from "./eda-manager.js";

// public
export interface EventBus extends Disposable
{
    initialize(manager: EdaManager): void;
    // publish(topic: string, event: EdaEvent): Promise<void>;
    
    publish(topic: string, ...events: ReadonlyArray<EdaEvent>): Promise<void>;
    

    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    subscribeToObservables(observerType: Function, observerId: string, watches: ReadonlyArray<ObservableWatch>): Promise<void>;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    unsubscribeFromObservables(observerType: Function, observerId: string, watches: ReadonlyArray<ObservableWatch>): Promise<void>;
}

export type ObservableWatch = {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    observableType: Function | string;
    observableId: string;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    observableEventType: Function | string;
    // observerEventHandlerType: Function;
};