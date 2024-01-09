import Grpc from "@grpc/grpc-js";
import ProtoLoader from "@grpc/proto-loader";
import { given } from "@nivinjoseph/n-defensive";
import { ApplicationException } from "@nivinjoseph/n-exception";
import { Logger } from "@nivinjoseph/n-log";
import { Disposable, Duration, Make, Uuid } from "@nivinjoseph/n-util";
import Path from "node:path";
import { ConnectionOptions } from "tls";
import { EdaManager } from "../eda-manager.js";
import { WorkItem } from "./scheduler.js";
import { fileURLToPath } from "node:url";


export class GrpcClientFactory
{
    private readonly _manager: EdaManager;
    private readonly _logger: Logger;
    private readonly _endpoint: string;
    private readonly _serviceDef: Grpc.GrpcObject | Grpc.ServiceClientConstructor | Grpc.ProtobufTypeDefinition;
    private readonly _creds: Grpc.ChannelCredentials;
    private readonly _clients = new Array<GrpcClientFacade>();
    // private readonly _disposableClients = new Array<GrpcClientInternal>();
    private _roundRobin = 0;
    
    
    public constructor(manager: EdaManager)
    {
        given(manager, "manager").ensureHasValue().ensureIsInstanceOf(EdaManager)
            .ensure(t => t.grpcProxyEnabled, "GRPC proxy not enabled");   
        this._manager = manager;
        
        this._logger = this._manager.serviceLocator.resolve<Logger>("Logger");
        
        this._endpoint = `${this._manager.grpcDetails!.host}:${this._manager.grpcDetails!.port}`;
        
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
        this._serviceDef = Grpc.loadPackageDefinition(packageDef).grpcprocessor;
        
        let isSecure = this._manager.grpcDetails!.host !== "localhost";
        if (this._manager.grpcDetails!.isSecure != null)
            isSecure = this._manager.grpcDetails!.isSecure!;
            
        if (isSecure)
        {
            const creds = Grpc.credentials.createSsl();
            const origConnectionOptions = creds._getConnectionOptions.bind(creds);
            creds._getConnectionOptions = function (): ConnectionOptions
            {
                const connOptions = origConnectionOptions()!;
                connOptions.rejectUnauthorized = false;
                return connOptions;
            };
            
            this._creds = creds;
            
            console.log("SECURE GRPC CREDENTIALS CREATED");
        }
        else
        {
            this._creds = Grpc.credentials.createInsecure();
            
            console.log("INSECURE GRPC CREDENTIALS CREATED");
        }
        
        let connectionPoolSize = this._manager.grpcDetails!.connectionPoolSize ?? 50;
        if (connectionPoolSize <= 0)
            connectionPoolSize = 50;
        
        Make.loop(() => this._clients.push(
            new GrpcClientFacade(new GrpcClientInternal(this._endpoint, this._serviceDef, this._creds, this._logger))),
            connectionPoolSize);
            
        // setInterval(() =>
        // {
        //     this._clients.forEach(client =>
        //     {
        //         if (client.internal.isOverused || client.internal.isStale)
        //         {
        //             const disposable = client.internal;
        //             client.swap(new GrpcClientInternal(this._endpoint, this._serviceDef, this._creds, this._logger));
        //             this._disposableClients.push(disposable);
        //         }
        //     });
            
        // }, Duration.fromMinutes(7).toMilliSeconds()).unref();
        
        // setInterval(() =>
        // {
        //     this._disposableClients.forEach(client =>
        //     {
        //         if (!client.isActive)
        //             client.dispose().catch(e => console.error(e));
        //     });
            
        //     this._disposableClients.where(t => t.isDisposed).forEach(t => this._disposableClients.remove(t));
        // }, Duration.fromMinutes(13).toMilliSeconds()).unref();
    }
    
    
    public create(): GrpcClient
    {
        if (this._roundRobin >= this._clients.length)
            this._roundRobin = 0;
        
        const client = this._clients[this._roundRobin];
        this._roundRobin++;
        return client;
    }
}

export interface GrpcClient
{
    process(workItem: WorkItem): Promise<{ eventName: string; eventId: string; }>;
}

class GrpcClientInternal implements GrpcClient, Disposable
{
    private readonly _id = Uuid.create();
    private readonly _createdAt = Date.now();
    private readonly _client: any;
    private readonly _logger: Logger;
    private _numInvocations = 0;
    private _activeInvocations = 0;
    private _isDisposing = false;
    private _isDisposed = false;
    
    
    public get id(): string { return this._id; }
    public get isStale(): boolean { return (this._createdAt + Duration.fromMinutes(10).toMilliSeconds()) < Date.now(); }
    public get isOverused(): boolean { return this._numInvocations > 1000; }
    public get isActive(): boolean { return this._activeInvocations > 0; }
    public get isDisposed(): boolean { return this._isDisposed; }
    
    
    public constructor(endpoint: string,
        serviceDef: Grpc.GrpcObject | Grpc.ServiceClientConstructor | Grpc.ProtobufTypeDefinition,
        creds: Grpc.ChannelCredentials, logger: Logger)
    {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        this._client = new (serviceDef as any).EdaService(endpoint, creds);
        this._logger = logger;
    }
    
    
    public process(workItem: WorkItem): Promise<{ eventName: string; eventId: string; }>
    {
        if (this._isDisposing)
            throw new ApplicationException("Using disposed client");
        
        return new Promise((resolve, reject) =>
        {
            this._numInvocations++;
            this._activeInvocations++;
            
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            this._client.process({
                consumerId: workItem.consumerId,
                topic: workItem.topic,
                partition: workItem.partition,
                eventName: workItem.eventName,
                payload: JSON.stringify(workItem.event.serialize())
            },
                // {
                //     deadline: Date.now() + Duration.fromSeconds(120).toMilliSeconds()
                // },
                (err: any, response: any) =>
                {
                    this._activeInvocations--;
                    
                    if (err)
                        reject(err);
                    else
                        resolve(response);
                });
        });
    }
    
    public async dispose(): Promise<void>
    {
        if (this._isDisposing || this._isDisposed)
            return;
        
        try 
        {
            this._isDisposing = true;
            
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            this._client.close();    
        }
        catch (error)
        {
            await this._logger.logWarning("Error while closing GRPC client");
            await this._logger.logError(error as any);
        }
        finally
        {
            this._isDisposed = true;
        }
    }
}

class GrpcClientFacade implements GrpcClient
{
    private _clientInternal: GrpcClientInternal;
    
    
    public get internal(): GrpcClientInternal { return this._clientInternal; }
    
    
    public constructor(clientInternal: GrpcClientInternal)
    {
        this._clientInternal = clientInternal;
    }
    
    public process(workItem: WorkItem): Promise<{ eventName: string; eventId: string; }>
    {
        return this._clientInternal.process(workItem);
    }
    
    public swap(clientInternal: GrpcClientInternal): void
    {
        this._clientInternal = clientInternal;
    }
}