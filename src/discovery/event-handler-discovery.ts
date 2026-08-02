import { given } from "@nivinjoseph/n-defensive";
import type {
    EdaEventHandler,
    ObserverEdaEventHandler
} from "@nivinjoseph/n-eda";
import type { ClassHierarchy } from "@nivinjoseph/n-util";
import { discoverClasses } from "./module-discovery.js";

// n-eda declares its handler contracts as interfaces, so there is no runtime
// base to test with `instanceof`. These are the same registration-symbols
// n-eda's own EventRegistration reads off the class; both are Symbol.for keys,
// so re-deriving them here is exact.
const eventSymbol = Symbol.for("@nivinjoseph/n-eda/event");
const observedEventSymbol = Symbol.for("@nivinjoseph/n-eda/observedEvent");

type EventHandlerClass = ClassHierarchy<
    // biome-ignore lint/suspicious/noExplicitAny: variance-free base for registration
    EdaEventHandler<any> | ObserverEdaEventHandler<any>
>;

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
export function discoverEventHandlers(
    directoryUrl: URL
): Promise<Array<EventHandlerClass>> 
{
    given(directoryUrl, "directoryUrl").ensureHasValue().ensureIsObject();

    return discoverClasses<EventHandlerClass>({
        directoryUrl,
        fileSuffix: "-event-handler.js",
        classNameSuffix: "EventHandler",
        kind: "event handler",
        isMatch: isEventHandlerClass,
    });
}

function isEventHandlerClass(value: unknown): value is EventHandlerClass 
{
    if (typeof value !== "function") return false;

    const prototype = (value as { prototype?: { handle?: unknown; }; }).prototype;
    if (prototype == null || typeof prototype.handle !== "function")
        return false;

    const metadata = (value as { [Symbol.metadata]?: Record<symbol, unknown>; })[
        Symbol.metadata
    ];
    return (
        metadata != null &&
        (metadata[eventSymbol] != null || metadata[observedEventSymbol] != null)
    );
}
