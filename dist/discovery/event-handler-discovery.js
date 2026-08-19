import { given } from "@nivinjoseph/n-defensive";
import { discoverClasses } from "./module-discovery.js";
// n-eda declares its handler contracts as interfaces, so there is no runtime
// base to test with `instanceof`. These are the same registration-symbols
// n-eda's own EventRegistration reads off the class; both are Symbol.for keys,
// so re-deriving them here is exact.
const eventSymbol = Symbol.for("@nivinjoseph/n-eda/event");
const observedEventSymbol = Symbol.for("@nivinjoseph/n-eda/observedEvent");
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
export function discoverEventHandlers(directoryUrl) {
    given(directoryUrl, "directoryUrl").ensureHasValue().ensureIsObject();
    return discoverClasses({
        directoryUrl,
        fileSuffix: "-event-handler.js",
        classNameSuffix: "EventHandler",
        kind: "event handler",
        isMatch: isEventHandlerClass,
    });
}
function isEventHandlerClass(value) {
    if (typeof value !== "function")
        return false;
    const prototype = value.prototype;
    if (prototype == null || typeof prototype.handle !== "function")
        return false;
    const metadata = value[Symbol.metadata];
    return (metadata != null &&
        (metadata[eventSymbol] != null || metadata[observedEventSymbol] != null));
}
//# sourceMappingURL=event-handler-discovery.js.map