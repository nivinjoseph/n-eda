import { ServiceLocator } from "@nivinjoseph/n-ject";
import { EdaEvent } from "../eda-event.js";
import { EdaManager } from "../eda-manager.js";
import { Processor } from "./processor.js";
import { WorkItem } from "./scheduler.js";
/**
 * The in-process dispatcher: creates a per-event DI child scope, resolves the handler by its class name, and
 * invokes `handle`.
 *
 * Contract: one child scope per event delivery, disposed in a `finally`. The scope is also stapled onto the
 * event as `$scope`, so retaining the event past `handle()` yields a disposed container. For observed events
 * the notification envelope is unwrapped first and the inner event is passed to the handler along with the
 * `observerId`.
 *
 * Note: resolution is by handler **class name**, which is why those names must be globally unique.
 */
export declare class DefaultProcessor extends Processor {
    private readonly _onEventReceived;
    constructor(manager: EdaManager, onEventReceived: (scope: ServiceLocator, topic: string, event: EdaEvent) => void);
    protected processEvent(workItem: WorkItem): Promise<void>;
}
//# sourceMappingURL=default-processor.d.ts.map