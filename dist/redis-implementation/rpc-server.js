import { ConfigurationManager } from "@nivinjoseph/n-config";
import { given } from "@nivinjoseph/n-defensive";
import { Container } from "@nivinjoseph/n-ject";
import { ConsoleLogger } from "@nivinjoseph/n-log";
import { ShutdownManager } from "@nivinjoseph/n-svc";
import { Delay } from "@nivinjoseph/n-util";
import Http from "node:http";
import Url from "node:url";
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
export class RpcServer {
    _port;
    _host;
    _container;
    _logger;
    _startupScriptKey = "$startupScript";
    _hasStartupScript = false;
    _shutdownScriptKey = "$shutdownScript";
    _hasShutdownScript = false;
    _disposeActions = new Array();
    _eventHandler;
    _server;
    _isBootstrapped = false;
    _shutdownManager = null;
    /**
     * @param port - port to listen on
     * @param host - interface to bind; nullable but positionally required
     * @param container - the n-ject container used to resolve scripts and handlers
     * @param logger - optional; defaults to a `ConsoleLogger` using JSON format outside `env=dev`
     * @throws if `port` is missing or not a number, or if `container` is missing or not a `Container`
     */
    constructor(port, host, container, logger) {
        given(port, "port").ensureHasValue().ensureIsNumber();
        this._port = port;
        given(host, "host").ensureIsString();
        this._host = host ? host.trim() : null;
        given(container, "container").ensureHasValue().ensureIsType(Container);
        this._container = container;
        given(logger, "logger").ensureIsObject();
        this._logger = logger ?? new ConsoleLogger({
            useJsonFormat: ConfigurationManager.getConfig("env") !== "dev"
        });
    }
    /**
     * Registers the handler that processes proxied events. **Mandatory** — `bootstrap()` fails without it.
     *
     * @param eventHandler - the handler, already passed to `EdaManager.actAsRpcConsumer(...)`
     * @returns this server, for chaining
     * @throws if the handler is missing or of the wrong type, or if called after `bootstrap()`
     */
    registerEventHandler(eventHandler) {
        given(eventHandler, "eventHandler").ensureHasValue().ensureIsInstanceOf(RpcEventHandler);
        given(this, "this").ensure(t => !t._isBootstrapped, "cannot invoke after bootstrap");
        this._eventHandler = eventHandler;
        return this;
    }
    /**
     * Registers a script to run during `bootstrap()`, before the server starts listening.
     *
     * @param applicationScriptClass - the script **class**; resolved from the container, so its constructor
     * dependencies are injected
     * @returns this server, for chaining
     * @throws if the class is missing, if a startup script is already registered, or if called after
     * `bootstrap()`
     */
    registerStartupScript(applicationScriptClass) {
        given(applicationScriptClass, "applicationScriptClass").ensureHasValue().ensureIsFunction();
        given(this, "this").ensure(t => !t._isBootstrapped, "cannot invoke after bootstrap");
        this._container.registerSingleton(this._startupScriptKey, applicationScriptClass);
        this._hasStartupScript = true;
        return this;
    }
    /**
     * Registers a script to run during shutdown, after connections have drained.
     *
     * @param applicationScriptClass - the script **class**; resolved from the container
     * @returns this server, for chaining
     * @throws if the class is missing, if a shutdown script is already registered, or if called after
     * `bootstrap()`
     */
    registerShutdownScript(applicationScriptClass) {
        given(applicationScriptClass, "applicationScriptClass").ensureHasValue().ensureIsFunction();
        given(this, "this").ensure(t => !t._isBootstrapped, "cannot invoke after bootstrap");
        this._container.registerSingleton(this._shutdownScriptKey, applicationScriptClass);
        this._hasShutdownScript = true;
        return this;
    }
    /**
     * Registers an arbitrary async cleanup action to run during shutdown. May be called repeatedly; actions
     * run in registration order.
     *
     * @param disposeAction - the cleanup function
     * @returns this server, for chaining
     * @throws if the action is missing or not a function, or if called after `bootstrap()`
     */
    registerDisposeAction(disposeAction) {
        given(disposeAction, "disposeAction").ensureHasValue().ensureIsFunction();
        given(this, "this").ensure(t => !t._isBootstrapped, "cannot invoke after bootstrap");
        this._disposeActions.push(() => {
            return new Promise((resolve) => {
                try {
                    disposeAction()
                        .then(() => resolve())
                        .catch((e) => {
                        // eslint-disable-next-line @typescript-eslint/no-floating-promises
                        this._logger.logError(e).finally(() => resolve());
                        // resolve();
                    });
                }
                catch (error) {
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    this._logger.logError(error).finally(() => resolve());
                    // resolve();
                }
            });
        });
        return this;
    }
    /**
     * Starts the server. **Synchronous**, unlike `EdaManager.bootstrap()`.
     *
     * Runs the startup script if one was registered, begins listening, and installs the shutdown manager.
     *
     * @throws if already bootstrapped, or if no event handler was registered
     */
    bootstrap() {
        given(this, "this")
            .ensure(t => !t._isBootstrapped, "already bootstrapped")
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            .ensure(t => t._eventHandler != null, "No event handler registered");
        this._configureContainer();
        this._configureStartup()
            .then(() => this._configureServer())
            .then(async () => {
            const appEnv = ConfigurationManager.getConfig("env");
            const appName = ConfigurationManager.getConfig("package.name");
            const appVersion = ConfigurationManager.getConfig("package.version");
            const appDescription = ConfigurationManager.getConfig("package.description");
            await this._logger.logInfo(`ENV: ${appEnv}; NAME: ${appName}; VERSION: ${appVersion}; DESCRIPTION: ${appDescription}.`);
            this._configureShutDown();
            this._isBootstrapped = true;
            await this._logger.logInfo("RPC SERVER STARTED");
        })
            .catch(async (e) => {
            await this._logger.logWarning("RPC SERVER STARTUP FAILED");
            await this._logger.logError(e);
            throw e;
        });
    }
    _configureContainer() {
        this.registerDisposeAction(() => this._container.dispose());
    }
    async _configureStartup() {
        await this._logger.logInfo("RPC SERVER STARTING...");
        if (this._hasStartupScript)
            await this._container.resolve(this._startupScriptKey).run();
    }
    _configureServer() {
        const server = Http.createServer((req, res) => {
            if (this._shutdownManager == null || this._shutdownManager.isShutdown) {
                res.writeHead(503);
                res.end("SERVER UNAVAILABLE");
                return;
            }
            const requestPath = Url.parse(req.url, true).pathname;
            switch (requestPath) {
                case "/health":
                    res.writeHead(200);
                    res.end();
                    break;
                case "/process":
                    {
                        let data = "";
                        req.on("data", chunk => {
                            data += chunk;
                        });
                        req.on("end", () => {
                            this._eventHandler.process(JSON.parse(data))
                                .then((result) => {
                                // if ((<any>result).statusCode != null)
                                // {
                                //     res.setHeader("Content-Type", "application/json");
                                //     res.writeHead(500);
                                //     res.end(JSON.stringify(result));
                                // }
                                res.setHeader("Content-Type", "application/json");
                                res.writeHead(200);
                                res.end(JSON.stringify(result));
                            })
                                .catch(error => {
                                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                                this._logger.logError(error)
                                    .finally(() => {
                                    res.writeHead(500);
                                    res.end();
                                });
                            });
                        });
                        break;
                    }
                default:
                    res.writeHead(404);
                    res.end();
                    break;
            }
        });
        return new Promise((resolve, _reject) => {
            this._server = server.listen(this._port, this._host ?? undefined, () => {
                resolve();
            });
        });
    }
    _configureShutDown() {
        this.registerDisposeAction(async () => {
            await this._logger.logInfo("CLEANING UP. PLEASE WAIT...");
            // return Delay.seconds(ConfigurationManager.getConfig<string>("env") === "dev" ? 2 : 20);
        });
        this._shutdownManager = new ShutdownManager(this._logger, [
            async () => {
                const seconds = ConfigurationManager.getConfig("env") === "dev" ? 2 : 15;
                await this._logger.logInfo(`BEGINNING WAIT (${seconds}S) FOR CONNECTION DRAIN...`);
                await Delay.seconds(seconds);
                await this._logger.logInfo("CONNECTION DRAIN COMPLETE");
            },
            () => {
                return new Promise((resolve, reject) => {
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    this._logger.logInfo("CLOSING RPC SERVER...").finally(() => {
                        // eslint-disable-next-line @typescript-eslint/no-misused-promises
                        this._server.close(async (err) => {
                            if (err) {
                                await this._logger.logWarning("RPC SERVER CLOSED WITH ERROR");
                                await this._logger.logError(err);
                                reject(err);
                                return;
                            }
                            await this._logger.logInfo("RPC SERVER CLOSED");
                            resolve();
                        });
                    });
                });
            },
            async () => {
                if (this._hasShutdownScript) {
                    await this._logger.logInfo("SHUTDOWN SCRIPT EXECUTING...");
                    try {
                        await this._container.resolve(this._shutdownScriptKey).run();
                        await this._logger.logInfo("SHUTDOWN SCRIPT COMPLETE");
                    }
                    catch (error) {
                        await this._logger.logWarning("SHUTDOWN SCRIPT ERROR");
                        await this._logger.logError(error);
                    }
                }
            },
            async () => {
                await this._logger.logInfo("DISPOSE ACTIONS EXECUTING...");
                try {
                    await Promise.allSettled(this._disposeActions.map(t => t()));
                    await this._logger.logInfo("DISPOSE ACTIONS COMPLETE");
                }
                catch (error) {
                    await this._logger.logWarning("DISPOSE ACTIONS ERROR");
                    await this._logger.logError(error);
                }
            }
        ]);
        // const shutDown = (signal: string): void =>
        // {
        //     if (this._isShutDown)
        //         return;
        //     this._isShutDown = true;
        //     // eslint-disable-next-line @typescript-eslint/no-floating-promises
        //     Delay.seconds(ConfigurationManager.getConfig<string>("env") === "dev" ? 2 : 15).then(() =>
        //     {
        //         // eslint-disable-next-line @typescript-eslint/no-misused-promises
        //         this._server.close(async () =>
        //         {
        //             console.warn(`SERVER STOPPING (${signal}).`);
        //             if (this._hasShutdownScript)
        //             {
        //                 console.log("Shutdown script executing.");
        //                 try
        //                 {
        //                     await this._container.resolve<ApplicationScript>(this._shutdownScriptKey).run();
        //                     console.log("Shutdown script complete.");
        //                 }
        //                 catch (error)
        //                 {
        //                     console.warn("Shutdown script error.");
        //                     console.error(error);
        //                 }
        //             }
        //             console.log("Dispose actions executing.");
        //             try
        //             {
        //                 await Promise.all(this._disposeActions.map(t => t()));
        //                 console.log("Dispose actions complete.");
        //             }
        //             catch (error)
        //             {
        //                 console.warn("Dispose actions error.");
        //                 console.error(error);
        //             }
        //             console.warn(`SERVER STOPPED (${signal}).`);
        //             process.exit(0);
        //         });    
        //     });
        // };
        // process.on("SIGTERM", () => shutDown("SIGTERM"));
        // process.on("SIGINT", () => shutDown("SIGINT"));
    }
}
//# sourceMappingURL=rpc-server.js.map