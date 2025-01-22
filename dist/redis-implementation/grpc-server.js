import Grpc from "@grpc/grpc-js";
import ProtoLoader from "@grpc/proto-loader";
import { ConfigurationManager } from "@nivinjoseph/n-config";
import { given } from "@nivinjoseph/n-defensive";
import { Container } from "@nivinjoseph/n-ject";
import { ConsoleLogger } from "@nivinjoseph/n-log";
import { ShutdownManager } from "@nivinjoseph/n-svc";
import { Delay } from "@nivinjoseph/n-util";
import Path from "node:path";
import { GrpcEventHandler } from "./grpc-event-handler.js";
import { fileURLToPath } from "node:url";
export class GrpcServer {
    constructor(port, host, container, logger) {
        this._startupScriptKey = "$startupScript";
        this._hasStartupScript = false;
        this._shutdownScriptKey = "$shutdownScript";
        this._hasShutdownScript = false;
        this._disposeActions = new Array();
        this._serviceName = "EdaService";
        this._statusMap = {
            "": ServingStatus.NOT_SERVING,
            [this._serviceName]: ServingStatus.NOT_SERVING
        };
        this._isBootstrapped = false;
        this._shutdownManager = null;
        given(port, "port").ensureHasValue().ensureIsNumber();
        this._port = port;
        given(host, "host").ensureIsString();
        this._host = host ? host.trim() : "0.0.0.0";
        given(container, "container").ensureHasValue().ensureIsType(Container);
        this._container = container;
        given(logger, "logger").ensureIsObject();
        this._logger = logger !== null && logger !== void 0 ? logger : new ConsoleLogger({
            useJsonFormat: ConfigurationManager.getConfig("env") !== "dev"
        });
    }
    registerEventHandler(eventHandler) {
        given(eventHandler, "eventHandler").ensureHasValue().ensureIsInstanceOf(GrpcEventHandler);
        given(this, "this").ensure(t => !t._isBootstrapped, "cannot invoke after bootstrap");
        this._eventHandler = eventHandler;
        return this;
    }
    registerStartupScript(applicationScriptClass) {
        given(applicationScriptClass, "applicationScriptClass").ensureHasValue().ensureIsFunction();
        given(this, "this").ensure(t => !t._isBootstrapped, "cannot invoke after bootstrap");
        this._container.registerSingleton(this._startupScriptKey, applicationScriptClass);
        this._hasStartupScript = true;
        return this;
    }
    registerShutdownScript(applicationScriptClass) {
        given(applicationScriptClass, "applicationScriptClass").ensureHasValue().ensureIsFunction();
        given(this, "this").ensure(t => !t._isBootstrapped, "cannot invoke after bootstrap");
        this._container.registerSingleton(this._shutdownScriptKey, applicationScriptClass);
        this._hasShutdownScript = true;
        return this;
    }
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
                        this._logger.logError(e)
                            .finally(() => resolve());
                        // resolve();
                    });
                }
                catch (error) {
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    this._logger.logError(error)
                        // .catch(t => console.error(t))
                        .finally(() => resolve());
                    // resolve();
                }
            });
        });
        return this;
    }
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
            await this._logger.logInfo("GRPC SERVER STARTED");
        })
            .catch(async (e) => {
            await this._logger.logWarning("GRPC SERVER STARTUP FAILED");
            await this._logger.logError(e);
            throw e;
        });
    }
    _configureContainer() {
        this.registerDisposeAction(() => this._container.dispose());
    }
    async _configureStartup() {
        await this._logger.logInfo("GRPC SERVER STARTING...");
        if (this._hasStartupScript)
            await this._container.resolve(this._startupScriptKey).run();
    }
    _configureServer() {
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
        server.addService(serviceDef[this._serviceName].service, {
            process: (call, callback) => {
                if (this._shutdownManager == null || this._shutdownManager.isShutdown) {
                    callback({ code: Grpc.status.UNAVAILABLE });
                    return;
                }
                const request = call.request;
                this._eventHandler.process(request)
                    .then((response) => {
                    callback(null, response);
                })
                    .catch(error => {
                    callback(error);
                });
            }
        });
        const healthPackageDef = ProtoLoader.loadSync(Path.join(basePath, "grpc-health-check.proto"), options);
        const healthServiceDef = Grpc.loadPackageDefinition(healthPackageDef).grpchealthv1;
        server.addService(healthServiceDef["Health"].service, {
            check: (_call, callback) => {
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
        return new Promise((resolve, reject) => {
            server.bindAsync(`${this._host}:${this._port}`, Grpc.ServerCredentials.createInsecure(), (error, _port) => {
                if (error != null) {
                    reject(error);
                    return;
                }
                try {
                    // console.log(`Server running at http://127.0.0.1:${port}`);
                    server.start();
                    this._server = server;
                    this._changeStatus(ServingStatus.SERVING);
                }
                catch (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }
    _configureShutDown() {
        // if (ConfigurationManager.getConfig<string>("env") === "dev")
        //     return;
        this.registerDisposeAction(async () => {
            await this._logger.logInfo("CLEANING UP. PLEASE WAIT...");
            // return Delay.seconds(ConfigurationManager.getConfig<string>("env") === "dev" ? 2 : 20);
        });
        this._shutdownManager = new ShutdownManager(this._logger, [
            async () => {
                const seconds = ConfigurationManager.getConfig("env") === "dev" ? 2 : 15;
                await this._logger.logInfo(`BEGINNING WAIT (${seconds}S) FOR CONNECTION DRAIN...`);
                this._changeStatus(ServingStatus.NOT_SERVING);
                await Delay.seconds(seconds);
                await this._logger.logInfo("CONNECTION DRAIN COMPLETE");
            },
            () => {
                return new Promise((resolve, reject) => {
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    this._logger.logInfo("CLOSING GRPC SERVER...").finally(() => {
                        // eslint-disable-next-line @typescript-eslint/no-misused-promises
                        this._server.tryShutdown(async (err) => {
                            if (err) {
                                await this._logger.logWarning("GRPC SERVER CLOSE ERRORED");
                                await this._logger.logError(err);
                                try {
                                    await this._logger.logInfo("FORCING GRPC SERVER SHUTDOWN...");
                                    this._server.forceShutdown();
                                    await this._logger.logInfo("FORCE SHUTDOWN OF GRPC SERVER COMPLETE");
                                }
                                catch (error) {
                                    await this._logger.logWarning("FORCE SHUTDOWN OF GRPC SERVER ERRORED");
                                    await this._logger.logError(error);
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
            async () => {
                if (this._hasShutdownScript) {
                    await this._logger.logInfo("SHUTDOWN SCRIPT EXECUTING...");
                    try {
                        await this._container.resolve(this._shutdownScriptKey).run();
                        await this._logger.logInfo("SHUTDOWN SCRIPT COMPLETE");
                    }
                    catch (error) {
                        await this._logger.logWarning("SHUTDOWN SCRIPT ERROR");
                        await this._logger.logWarning(error);
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
    }
    _changeStatus(status) {
        given(status, "status").ensureHasValue().ensureIsEnum(ServingStatus);
        this._statusMap[""] = this._statusMap[this._serviceName] = status;
    }
}
var ServingStatus;
(function (ServingStatus) {
    ServingStatus["UNKNOWN"] = "UNKNOWN";
    ServingStatus["SERVING"] = "SERVING";
    ServingStatus["NOT_SERVING"] = "NOT_SERVING";
    ServingStatus["SERVICE_UNKNOWN"] = "SERVICE_UNKNOWN"; // Used only by the Watch method.
})(ServingStatus || (ServingStatus = {}));
//# sourceMappingURL=grpc-server.js.map