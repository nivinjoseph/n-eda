import { Container } from "@nivinjoseph/n-ject";
import { Logger } from "@nivinjoseph/n-log";
import { ClassHierarchy } from "@nivinjoseph/n-util";
import { ApplicationScript } from "./application-script.js";
import { GrpcEventHandler } from "./grpc-event-handler.js";
export declare class GrpcServer {
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
    private readonly _serviceName;
    private readonly _statusMap;
    private _server;
    private _isBootstrapped;
    private _shutdownManager;
    constructor(port: number, host: string | null, container: Container, logger?: Logger | null);
    registerEventHandler(eventHandler: GrpcEventHandler): this;
    registerStartupScript(applicationScriptClass: ClassHierarchy<ApplicationScript>): this;
    registerShutdownScript(applicationScriptClass: ClassHierarchy<ApplicationScript>): this;
    registerDisposeAction(disposeAction: () => Promise<void>): this;
    bootstrap(): void;
    private _configureContainer;
    private _configureStartup;
    private _configureServer;
    private _configureShutDown;
    private _changeStatus;
}
//# sourceMappingURL=grpc-server.d.ts.map