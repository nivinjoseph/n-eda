export type ModuleDiscoveryOptions<T> = {
    /** The scanned directory, always passed by the app as
     * `new URL("./<dir>", import.meta.url)` — never derived from `cwd`. */
    directoryUrl: URL;
    /** Emitted filename suffix, e.g. `-controller.js`. Matched exactly, which
     * is what excludes the `.d.ts` / `.js.map` / `.d.ts.map` siblings. */
    fileSuffix: string;
    /** Required class-name suffix, e.g. `Controller`. */
    classNameSuffix: string;
    /** Artifact noun used in error messages, e.g. `controller`. */
    kind: string;
    isMatch: (value: unknown) => value is T;
};
/**
 * Discovers registrable classes by scanning the app's own emitted output and
 * dynamically importing every file whose name ends with `fileSuffix`.
 *
 * The server-side counterpart of the client's `import.meta.glob` discovery:
 * there is no bundler here, so the scan happens at boot against `dist/`. The
 * app passes its own directory URL (`import.meta.url`-relative), so discovery
 * never depends on the working directory.
 *
 * A missing directory throws (that is a path typo). An empty directory yields
 * `[]` — a freshly scaffolded app legitimately has no artifacts yet. A class
 * whose name starts with `_` is a deliberate opt-out and is skipped.
 * Registration is keyed on `class.name`, so names must be unique per app.
 */
export declare function discoverClasses<T>(options: ModuleDiscoveryOptions<T>): Promise<Array<T>>;
//# sourceMappingURL=module-discovery.d.ts.map