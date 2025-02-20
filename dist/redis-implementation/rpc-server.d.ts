import { Container } from "@nivinjoseph/n-ject";
import { Logger } from "@nivinjoseph/n-log";
import { ClassHierarchy } from "@nivinjoseph/n-util";
import { ApplicationScript } from "./application-script.js";
import { RpcEventHandler } from "./rpc-event-handler.js";
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
    constructor(port: number, host: string | null, container: Container, logger?: Logger | null);
    registerEventHandler(eventHandler: RpcEventHandler): this;
    registerStartupScript(applicationScriptClass: ClassHierarchy<ApplicationScript>): this;
    registerShutdownScript(applicationScriptClass: ClassHierarchy<ApplicationScript>): this;
    registerDisposeAction(disposeAction: () => Promise<void>): this;
    bootstrap(): void;
    private _configureContainer;
    private _configureStartup;
    private _configureServer;
    private _configureShutDown;
}
//# sourceMappingURL=rpc-server.d.ts.map