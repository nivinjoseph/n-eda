/**
 * A one-shot script run by `RpcServer` or `GrpcServer` at startup or shutdown.
 *
 * Contract: register the **class**, not an instance, via `registerStartupScript` / `registerShutdownScript`.
 * The server registers it as a singleton in its container and resolves it, so constructor dependencies are
 * injected normally. Startup scripts run during `bootstrap()`; shutdown scripts run from the server's
 * `ShutdownManager` on SIGTERM.
 *
 * Note: this is an interface, not a base class — `implements` it.
 *
 * @example
 * ```typescript
 * @inject("Logger")
 * export class MigrationScript implements ApplicationScript
 * {
 *     public constructor(private readonly _logger: Logger) { }
 *
 *     public async run(): Promise<void>
 *     {
 *         await this._logger.logInfo("running migrations");
 *     }
 * }
 *
 * new RpcServer(8080, null, container)
 *     .registerEventHandler(new RpcEventHandler())
 *     .registerStartupScript(MigrationScript)
 *     .bootstrap();
 * ```
 */
export interface ApplicationScript {
    /** Executes the script. A rejection aborts server bootstrap. */
    run(): Promise<void>;
}
//# sourceMappingURL=application-script.d.ts.map