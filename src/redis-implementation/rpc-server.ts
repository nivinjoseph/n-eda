import { ConfigurationManager } from "@nivinjoseph/n-config";
import { given } from "@nivinjoseph/n-defensive";
import { Container } from "@nivinjoseph/n-ject";
import { ConsoleLogger, Logger } from "@nivinjoseph/n-log";
import { ShutdownManager } from "@nivinjoseph/n-svc";
import { ClassHierarchy, Delay } from "@nivinjoseph/n-util";
import Http from "node:http";
import Url from "node:url";
import { ApplicationScript } from "./application-script.js";
import { RpcEventHandler } from "./rpc-event-handler.js";


export class RpcServer
{
    private readonly _port: number;
    private readonly _host: string | null;
    private readonly _container: Container;
    private readonly _logger: Logger;

    private readonly _startupScriptKey = "$startupScript";
    private _hasStartupScript = false;

    private readonly _shutdownScriptKey = "$shutdownScript";
    private _hasShutdownScript = false;

    private readonly _disposeActions = new Array<() => Promise<void>>();

    private _eventHandler!: RpcEventHandler;

    private _server!: Http.Server;
    private _isBootstrapped = false;

    private _shutdownManager: ShutdownManager | null = null;


    public constructor(port: number, host: string | null, container: Container, logger?: Logger | null)
    {
        given(port, "port").ensureHasValue().ensureIsNumber();
        this._port = port;

        given(host as string, "host").ensureIsString();
        this._host = host ? host.trim() : null;

        given(container, "container").ensureHasValue().ensureIsType(Container);
        this._container = container;

        given(logger as Logger, "logger").ensureIsObject();
        this._logger = logger ?? new ConsoleLogger({
            useJsonFormat: ConfigurationManager.getConfig<string>("env") !== "dev"
        });
    }

    public registerEventHandler(eventHandler: RpcEventHandler): this
    {
        given(eventHandler, "eventHandler").ensureHasValue().ensureIsInstanceOf(RpcEventHandler);

        given(this, "this").ensure(t => !t._isBootstrapped, "cannot invoke after bootstrap");

        this._eventHandler = eventHandler;

        return this;
    }

    public registerStartupScript(applicationScriptClass: ClassHierarchy<ApplicationScript>): this
    {
        given(applicationScriptClass, "applicationScriptClass").ensureHasValue().ensureIsFunction();

        given(this, "this").ensure(t => !t._isBootstrapped, "cannot invoke after bootstrap");

        this._container.registerSingleton(this._startupScriptKey, applicationScriptClass);
        this._hasStartupScript = true;
        return this;
    }

    public registerShutdownScript(applicationScriptClass: ClassHierarchy<ApplicationScript>): this
    {
        given(applicationScriptClass, "applicationScriptClass").ensureHasValue().ensureIsFunction();

        given(this, "this").ensure(t => !t._isBootstrapped, "cannot invoke after bootstrap");

        this._container.registerSingleton(this._shutdownScriptKey, applicationScriptClass);
        this._hasShutdownScript = true;
        return this;
    }

    public registerDisposeAction(disposeAction: () => Promise<void>): this
    {
        given(disposeAction, "disposeAction").ensureHasValue().ensureIsFunction();

        given(this, "this").ensure(t => !t._isBootstrapped, "cannot invoke after bootstrap");

        this._disposeActions.push(() =>
        {
            return new Promise((resolve) =>
            {
                try 
                {
                    disposeAction()
                        .then(() => resolve())
                        .catch((e) =>
                        {
                            // eslint-disable-next-line @typescript-eslint/no-floating-promises
                            this._logger.logError(e).finally(() => resolve());
                            // resolve();
                        });
                }
                catch (error: any)
                {
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    this._logger.logError(error).finally(() => resolve());
                    // resolve();
                }
            });
        });
        return this;
    }

    public bootstrap(): void
    {
        given(this, "this")
            .ensure(t => !t._isBootstrapped, "already bootstrapped")
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            .ensure(t => t._eventHandler != null, "No event handler registered");


        this._configureContainer();

        this._configureStartup()
            .then(() => this._configureServer())
            .then(async () =>
            {
                const appEnv = ConfigurationManager.getConfig<string>("env");
                const appName = ConfigurationManager.getConfig<string>("package.name");
                const appVersion = ConfigurationManager.getConfig<string>("package.version");
                const appDescription = ConfigurationManager.getConfig<string>("package.description");

                await this._logger.logInfo(`ENV: ${appEnv}; NAME: ${appName}; VERSION: ${appVersion}; DESCRIPTION: ${appDescription}.`);

                this._configureShutDown();

                this._isBootstrapped = true;
                await this._logger.logInfo("RPC SERVER STARTED");
            })
            .catch(async e =>
            {
                await this._logger.logWarning("RPC SERVER STARTUP FAILED");
                await this._logger.logError(e);
                throw e;
            });
    }

    private _configureContainer(): void
    {
        this.registerDisposeAction(() => this._container.dispose());
    }

    private async _configureStartup(): Promise<void>
    {
        await this._logger.logInfo("RPC SERVER STARTING...");

        if (this._hasStartupScript)
            await this._container.resolve<ApplicationScript>(this._startupScriptKey).run();
    }

    private _configureServer(): Promise<void>
    {
        const server = Http.createServer((req, res) =>
        {
            if (this._shutdownManager == null || this._shutdownManager.isShutdown)
            {
                res.writeHead(503);
                res.end("SERVER UNAVAILABLE");
                return;
            }

            const requestPath = Url.parse(req.url!, true).pathname;

            switch (requestPath)
            {
                case "/health":
                    res.writeHead(200);
                    res.end();
                    break;
                case "/process":
                    {
                        let data = "";
                        req.on("data", chunk =>
                        {
                            data += chunk;
                        });
                        req.on("end", () =>
                        {
                            this._eventHandler.process(JSON.parse(data))
                                .then((result) =>
                                {
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
                                .catch(error =>
                                {
                                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                                    this._logger.logError(error)
                                        .finally(() =>
                                        {
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

        return new Promise((resolve, _reject) =>
        {
            this._server = server.listen(this._port, this._host ?? undefined, () =>
            {
                resolve();
            });
        });
    }

    private _configureShutDown(): void
    {
        this.registerDisposeAction(async () =>
        {
            await this._logger.logInfo("CLEANING UP. PLEASE WAIT...");
            // return Delay.seconds(ConfigurationManager.getConfig<string>("env") === "dev" ? 2 : 20);
        });

        this._shutdownManager = new ShutdownManager(this._logger, [
            async (): Promise<void> =>
            {
                const seconds = ConfigurationManager.getConfig<string>("env") === "dev" ? 2 : 15;
                await this._logger.logInfo(`BEGINNING WAIT (${seconds}S) FOR CONNECTION DRAIN...`);
                await Delay.seconds(seconds);
                await this._logger.logInfo("CONNECTION DRAIN COMPLETE");
            },
            (): Promise<void> =>
            {
                return new Promise((resolve, reject) =>
                {
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    this._logger.logInfo("CLOSING RPC SERVER...").finally(() =>
                    {
                        // eslint-disable-next-line @typescript-eslint/no-misused-promises
                        this._server.close(async (err) =>
                        {
                            if (err)
                            {
                                await this._logger.logWarning("RPC SERVER CLOSED WITH ERROR");
                                await this._logger.logError(err as any);
                                reject(err);
                                return;
                            }
                            await this._logger.logInfo("RPC SERVER CLOSED");
                            resolve();
                        });
                    });

                });
            },
            async (): Promise<void> =>
            {
                if (this._hasShutdownScript)
                {
                    await this._logger.logInfo("SHUTDOWN SCRIPT EXECUTING...");
                    try
                    {
                        await this._container.resolve<ApplicationScript>(this._shutdownScriptKey).run();
                        await this._logger.logInfo("SHUTDOWN SCRIPT COMPLETE");
                    }
                    catch (error)
                    {
                        await this._logger.logWarning("SHUTDOWN SCRIPT ERROR");
                        await this._logger.logError(error as any);
                    }
                }
            },
            async (): Promise<void> =>
            {
                await this._logger.logInfo("DISPOSE ACTIONS EXECUTING...");
                try
                {
                    await Promise.allSettled(this._disposeActions.map(t => t()));
                    await this._logger.logInfo("DISPOSE ACTIONS COMPLETE");
                }
                catch (error)
                {
                    await this._logger.logWarning("DISPOSE ACTIONS ERROR");
                    await this._logger.logError(error as any);
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