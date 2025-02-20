import { Disposable } from "@nivinjoseph/n-util";
import { EdaManager } from "./eda-manager.js";
export interface EventSubMgr extends Disposable {
    initialize(manager: EdaManager): void;
    consume(): Promise<void>;
}
//# sourceMappingURL=event-sub-mgr.d.ts.map