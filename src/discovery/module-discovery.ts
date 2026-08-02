import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { given } from "@nivinjoseph/n-defensive";
import { ApplicationException } from "@nivinjoseph/n-exception";

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
    // eslint-disable-next-line @typescript-eslint/method-signature-style
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
export async function discoverClasses<T>(
    options: ModuleDiscoveryOptions<T>
): Promise<Array<T>> 
{
    given(options, "options").ensureHasValue().ensureIsObject();

    const { directoryUrl, fileSuffix, classNameSuffix, kind, isMatch } =
        options;

    given(directoryUrl, "directoryUrl").ensureHasValue().ensureIsObject();
    given(fileSuffix, "fileSuffix").ensureHasValue().ensureIsString();
    given(classNameSuffix, "classNameSuffix").ensureHasValue().ensureIsString();
    given(kind, "kind").ensureHasValue().ensureIsString();
    given(isMatch, "isMatch").ensureHasValue().ensureIsFunction();

    const directory = fileURLToPath(directoryUrl);
    const filePaths = await findFiles(directory, fileSuffix, kind);

    const seen = new Map<string, { value: T; path: string; }>();
    const discovered: Array<T> = [];

    for (const filePath of filePaths) 
    {
        const displayPath = relative(directory, filePath);
        const module = (await import(pathToFileURL(filePath).href)) as Record<
            string,
            unknown
        >;

        const matches = Object.values(module).filter(isMatch);
        if (matches.length === 0)
            throw new ApplicationException(
                `${kind} discovery: '${displayPath}' matched the ${kind} file convention but exports no ${kind}.`
            );

        for (const match of matches) 
        {
            const name = (match as { name: string; }).name;
            if (name.startsWith("_")) continue;

            if (!name.endsWith(classNameSuffix))
                throw new ApplicationException(
                    `${kind} discovery: '${name}' in '${displayPath}' does not end with '${classNameSuffix}'.`
                );

            const existing = seen.get(name);
            if (existing != null) 
            {
                if (existing.value === match) continue;
                throw new ApplicationException(
                    `${kind} discovery: '${existing.path}' and '${displayPath}' both resolve to name '${name}'; registration is keyed on class.name, so names must be unique per app.`
                );
            }

            seen.set(name, { value: match, path: displayPath });
            discovered.push(match);
        }
    }

    return discovered;
}

async function findFiles(
    directory: string,
    fileSuffix: string,
    kind: string
): Promise<Array<string>> 
{
    const entries = await readdir(directory, {
        recursive: true,
        withFileTypes: true,
    }).catch((error: NodeJS.ErrnoException) => 
    {
        if (error.code === "ENOENT")
            throw new ApplicationException(
                `${kind} discovery: directory '${directory}' not found.`
            );
        throw error;
    });

    return entries
        .filter((t) => t.isFile() && t.name.endsWith(fileSuffix))
        .map((t) => join(t.parentPath, t.name))
        .sort();
}
