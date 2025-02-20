import { ServiceLocator } from "@nivinjoseph/n-ject";
import { EdaEvent } from "../eda-event.js";
import { EdaManager } from "../eda-manager.js";
import { Processor } from "./processor.js";
import { WorkItem } from "./scheduler.js";
export declare class DefaultProcessor extends Processor {
    private readonly _onEventReceived;
    constructor(manager: EdaManager, onEventReceived: (scope: ServiceLocator, topic: string, event: EdaEvent) => void);
    protected processEvent(workItem: WorkItem): Promise<void>;
}
//# sourceMappingURL=default-processor.d.ts.map