import type { EdaEventHandler, ObserverEdaEventHandler } from "@nivinjoseph/n-eda";
import type { ClassHierarchy } from "@nivinjoseph/n-util";
type EventHandlerClass = ClassHierarchy<EdaEventHandler<any> | ObserverEdaEventHandler<any>>;
/**
 * Discovers n-eda event handlers under the given directory — the app's own
 * `new URL("./event-handlers", import.meta.url)`. Spread the result into
 * `EdaManager.registerEventHandlers(...)`.
 *
 * Contract: file `<name>-event-handler.ts` (emitted `-event-handler.js`)
 * exporting a class named `<Pascal>EventHandler` with `@event(...)` (or
 * `@observedEvent(...)`) applied and a `handle` method. A `_` name prefix
 * opts out.
 *
 * Note: the scan reads **emitted `.js`**, recursively, in sorted order — so
 * registration is deterministic, and the URL must point at the compiled
 * output (hence `import.meta.url`, never a `cwd`-derived path).
 *
 * @param directoryUrl - directory to scan, as a `file:` URL
 * @returns the discovered handler classes, sorted by file path
 * @throws `ApplicationException` if the directory does not exist, a matching
 * file exports no handler, a discovered class name does not end with
 * `EventHandler`, or two distinct classes share a name
 *
 * @example
 * ```typescript
 * edaManager.registerEventHandlers(
 *     ...await discoverEventHandlers(new URL("./event-handlers", import.meta.url)));
 * ```
 */
export declare function discoverEventHandlers(directoryUrl: URL): Promise<Array<EventHandlerClass>>;
export {};
//# sourceMappingURL=event-handler-discovery.d.ts.map