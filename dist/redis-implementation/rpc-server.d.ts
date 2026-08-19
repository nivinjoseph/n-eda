import { Container } from "@nivinjoseph/n-ject";
import { Logger } from "@nivinjoseph/n-log";
import { ClassHierarchy } from "@nivinjoseph/n-util";
import { ApplicationScript } from "./application-script.js";
import { RpcEventHandler } from "./rpc-event-handler.js";
/**
 * Standalone HTTP server that hosts a RpcEventHandler as an out-of-process event consumer.
 *
 * Contract: construct it, call {@link RpcServer.registerEventHandler} (mandatory), optionally register startup /
 * shutdown scripts and dispose actions, then call {@link RpcServer.bootstrap}. Every `register*` method must
 * precede `bootstrap()`. It stands up an `Http.Server` serving `http://<host>:<port>/process` and installs an n-svc
 * `ShutdownManager` that drains connections on SIGTERM — 2 seconds when `env` is `"dev"`, otherwise 15.
 *
 * Note: the transport is insecure and unauthenticated. Run it only on a trusted network.
 */
export declare class RpcServer {
    private readonly _port;
    private readonly _host;
    private readonly _container;
    private readonly _logger;
    private readonly _startupScriptKey;
    private _hasStartupScript;
    private readonly _shutdownScriptKey;
    private _hasShutdownScript;
    private readonly _disposeActions;
    private _eventHandler;
    private _server;
    private _isBootstrapped;
    private _shutdownManager;
    /**
     * @param port - port to listen on
     * @param host - interface to bind; nullable but positionally required
     * @param container - the n-ject container used to resolve scripts and handlers
     * @param logger - optional; defaults to a `ConsoleLogger` using JSON format outside `env=dev`
     * @throws if `port` is missing or not a number, or if `container` is missing or not a `Container`
     */
    constructor(port: number, host: string | null, container: Container, logger?: Logger | null);
    /**
     * Registers the handler that processes proxied events. **Mandatory** — `bootstrap()` fails without it.
     *
     * @param eventHandler - the handler, already passed to `EdaManager.actAsRpcConsumer(...)`
     * @returns this server, for chaining
     * @throws if the handler is missing or of the wrong type, or if called after `bootstrap()`
     */
    registerEventHandler(eventHandler: RpcEventHandler): this;
    /**
     * Registers a script to run during `bootstrap()`, before the server starts listening.
     *
     * @param applicationScriptClass - the script **class**; resolved from the container, so its constructor
     * dependencies are injected
     * @returns this server, for chaining
     * @throws if the class is missing, if a startup script is already registered, or if called after
     * `bootstrap()`
     */
    registerStartupScript(applicationScriptClass: ClassHierarchy<ApplicationScript>): this;
    /**
     * Registers a script to run during shutdown, after connections have drained.
     *
     * @param applicationScriptClass - the script **class**; resolved from the container
     * @returns this server, for chaining
     * @throws if the class is missing, if a shutdown script is already registered, or if called after
     * `bootstrap()`
     */
    registerShutdownScript(applicationScriptClass: ClassHierarchy<ApplicationScript>): this;
    /**
     * Registers an arbitrary async cleanup action to run during shutdown. May be called repeatedly; actions
     * run in registration order.
     *
     * @param disposeAction - the cleanup function
     * @returns this server, for chaining
     * @throws if the action is missing or not a function, or if called after `bootstrap()`
     */
    registerDisposeAction(disposeAction: () => Promise<void>): this;
    /**
     * Starts the server. **Synchronous**, unlike `EdaManager.bootstrap()`.
     *
     * Runs the startup script if one was registered, begins listening, and installs the shutdown manager.
     *
     * @throws if already bootstrapped, or if no event handler was registered
     */
    bootstrap(): void;
    private _configureContainer;
    private _configureStartup;
    private _configureServer;
    private _configureShutDown;
}
//# sourceMappingURL=rpc-server.d.ts.map