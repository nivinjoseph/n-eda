import { Disposable } from "@nivinjoseph/n-util";
import { EdaManager } from "./eda-manager";

// public
export interface EventSubMgr extends Disposable
{
    initialize(manager: EdaManager): void;
    consume(): Promise<void>;
}