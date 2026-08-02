import type { EdaEventHandler, ObserverEdaEventHandler } from "@nivinjoseph/n-eda";
import type { ClassHierarchy } from "@nivinjoseph/n-util";
type EventHandlerClass = ClassHierarchy<EdaEventHandler<any> | ObserverEdaEventHandler<any>>;
/**
 * Discovers n-eda event handlers under the given directory — the app's own
 * `new URL("./event-handlers", import.meta.url)`. Pass the result as
 * `EdaManagerOptions.eventHandlers`.
 *
 * Contract: file `<name>-event-handler.ts` (emitted `-event-handler.js`)
 * exporting a class named `<Pascal>EventHandler` with `@event(...)` (or
 * `@observedEvent(...)`) applied and a `handle` method. A `_` name prefix
 * opts out.
 */
export declare function discoverEventHandlers(directoryUrl: URL): Promise<Array<EventHandlerClass>>;
export {};
//# sourceMappingURL=event-handler-discovery.d.ts.map