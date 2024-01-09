import Grpc from "@grpc/grpc-js";
import ProtoLoader from "@grpc/proto-loader";
import { ConfigurationManager } from "@nivinjoseph/n-config";
import { given } from "@nivinjoseph/n-defensive";
import { Container } from "@nivinjoseph/n-ject";
import { ConsoleLogger, Logger } from "@nivinjoseph/n-log";
import { ShutdownManager } from "@nivinjoseph/n-svc";
import { ClassHierarchy, Delay } from "@nivinjoseph/n-util";
import Path from "node:path";
import { GrpcModel } from "../grpc-details.js";
import { ApplicationScript } from "./application-script.js";
import { GrpcEventHandler } from "./grpc-event-handler.js";
import { fileURLToPath } from "node:url";


export class GrpcServer
{
    private readonly _port: number;
    private readonly _host: string;
    private readonly _container: Container;
    private readonly _logger: Logger;

    private readonly _startupScriptKey = "$startupScript";
    private _hasStartupScript = false;

    private readonly _shutdownScriptKey = "$shutdownScript";
    private _hasShutdownScript = false;

    private readonly _disposeActions = new Array<() => Promise<void>>();

    private _eventHandler!: GrpcEventHandler;

    private readonly _serviceName = "EdaService";

    private readonly _statusMap: Record<string, ServingStatus> = {
        "": ServingStatus.NOT_SERVING,
        [this._serviceName]: ServingStatus.NOT_SERVING
    };

    private _server!: Grpc.Server;
    private _isBootstrapped = false;

    private _shutdownManager: ShutdownManager | null = null;


    public constructor(port: number, host: string | null, container: Container, logger?: Logger | null)
    {
        given(port, "port").ensureHasValue().ensureIsNumber();
        this._port = port;

        given(host as string, "host").ensureIsString();
        this._host = host ? host.trim() : "0.0.0.0";

        given(container, "container").ensureHasValue().ensureIsType(Container);
        this._container = container;

        given(logger as Logger, "logger").ensureIsObject();
        this._logger = logger ?? new ConsoleLogger({
            useJsonFormat: ConfigurationManager.getConfig<string>("env") !== "dev"
        });
    }

    public registerEventHandler(eventHandler: GrpcEventHandler): this
    {
        given(eventHandler, "eventHandler").ensureHasValue().ensureIsInstanceOf(GrpcEventHandler);

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
                            this._logger.logError(e)
                                .finally(() => resolve());
                            // resolve();
                        });
                }
                catch (error)
                {
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    this._logger.logError(error as any)
                        // .catch(t => console.error(t))
                        .finally(() => resolve());
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
                await this._logger.logInfo("GRPC SERVER STARTED");
            })
            .catch(async e =>
            {
                await this._logger.logWarning("GRPC SERVER STARTUP FAILED");
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
        await this._logger.logInfo("GRPC SERVER STARTING...");

        if (this._hasStartupScript)
            await this._container.resolve<ApplicationScript>(this._startupScriptKey).run();
    }

    private _configureServer(): Promise<void>
    {
        const options = {
            keepCase: false,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true
        };

        const dirname = Path.dirname(fileURLToPath(import.meta.url));
        const basePath = dirname.endsWith(`dist${Path.sep}redis-implementation`)
            ? Path.resolve(dirname, "..", "..", "src", "redis-implementation")
            : dirname;

        const packageDef = ProtoLoader.loadSync(Path.join(basePath, "grpc-processor.proto"), options);
        const serviceDef = Grpc.loadPackageDefinition(packageDef).grpcprocessor;

        const server = new Grpc.Server();

        server.addService((serviceDef as any)[this._serviceName].service, {
            process: (call: any, callback: Function) =>
            {
                if (this._shutdownManager == null || this._shutdownManager.isShutdown)
                {
                    callback({ code: Grpc.status.UNAVAILABLE });
                    return;
                }

                const request = call.request as GrpcModel;

                this._eventHandler.process(request)
                    .then((response) =>
                    {
                        callback(null, response);
                    })
                    .catch(error =>
                    {
                        callback(error);
                    });
            }
        });

        const healthPackageDef = ProtoLoader.loadSync(Path.join(basePath, "grpc-health-check.proto"), options);
        const healthServiceDef = Grpc.loadPackageDefinition(healthPackageDef).grpchealthv1;

        server.addService((healthServiceDef as any)["Health"].service, {
            check: (_call: any, callback: Function) =>
            {
                // const service = call.request ?? "";
                // const status = this._statusMap[service];
                // // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                // if (status == null)
                // {
                //     callback({ code: Grpc.status.NOT_FOUND });
                // }
                // else if (status === ServingStatus.SERVING)
                // {
                //     callback({ code: Grpc.status.OK });

                //     // callback(null, { status });
                // }
                // else
                // {
                //     callback({ code: Grpc.status.UNAVAILABLE });
                // }

                const status = this._statusMap[this._serviceName];
                if (status === ServingStatus.SERVING)
                    callback(null, { status });
                else
                    callback({ code: Grpc.status.UNAVAILABLE });
            }
        });


        return new Promise<void>((resolve, reject) =>
        {
            server.bindAsync(
                `${this._host}:${this._port}`,
                Grpc.ServerCredentials.createInsecure(),
                (error, _port) =>
                {
                    if (error != null)
                    {
                        reject(error);
                        return;
                    }

                    try 
                    {
                        // console.log(`Server running at http://127.0.0.1:${port}`);
                        server.start();
                        this._server = server;
                        this._changeStatus(ServingStatus.SERVING);
                    }
                    catch (error)
                    {
                        reject(error);
                        return;
                    }

                    resolve();
                }
            );
        });
    }

    private _configureShutDown(): void
    {
        // if (ConfigurationManager.getConfig<string>("env") === "dev")
        //     return;

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
                this._changeStatus(ServingStatus.NOT_SERVING);
                await Delay.seconds(seconds);
                await this._logger.logInfo("CONNECTION DRAIN COMPLETE");
            },
            (): Promise<void> =>
            {
                return new Promise((resolve, reject) =>
                {
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    this._logger.logInfo("CLOSING GRPC SERVER...").finally(() =>
                    {
                        // eslint-disable-next-line @typescript-eslint/no-misused-promises
                        this._server.tryShutdown(async (err) =>
                        {
                            if (err)
                            {
                                await this._logger.logWarning("GRPC SERVER CLOSE ERRORED");
                                await this._logger.logError(err as any);

                                try 
                                {
                                    await this._logger.logInfo("FORCING GRPC SERVER SHUTDOWN...");
                                    this._server.forceShutdown();
                                    await this._logger.logInfo("FORCE SHUTDOWN OF GRPC SERVER COMPLETE");
                                }
                                catch (error) 
                                {
                                    await this._logger.logWarning("FORCE SHUTDOWN OF GRPC SERVER ERRORED");
                                    await this._logger.logError(error as any);
                                    reject(error);
                                    return;
                                }
                            }
                            await this._logger.logInfo("GRPC SERVER CLOSED");
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
                        await this._logger.logWarning(error as any);
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
    }

    private _changeStatus(status: ServingStatus): void
    {
        given(status, "status").ensureHasValue().ensureIsEnum(ServingStatus);

        this._statusMap[""] = this._statusMap[this._serviceName] = status;
    }
}

enum ServingStatus
{
    UNKNOWN = "UNKNOWN",
    SERVING = "SERVING",
    NOT_SERVING = "NOT_SERVING",
    SERVICE_UNKNOWN = "SERVICE_UNKNOWN" // Used only by the Watch method.
}