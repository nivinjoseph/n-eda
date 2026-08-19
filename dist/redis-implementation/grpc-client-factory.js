import Grpc from "@grpc/grpc-js";
import ProtoLoader from "@grpc/proto-loader";
import { given } from "@nivinjoseph/n-defensive";
import { ApplicationException } from "@nivinjoseph/n-exception";
import { Duration, Make, Uuid } from "@nivinjoseph/n-util";
import Path from "node:path";
// import { ConnectionOptions } from "tls";
import { fileURLToPath } from "node:url";
import { EdaManager } from "../eda-manager.js";
/**
 * Builds and hands out gRPC clients from a fixed round-robin pool.
 *
 * Contract: pool size comes from `GrpcDetails.connectionPoolSize`, defaulting to 50 (a value of 0 or less is
 * coerced to the default). Credentials are always insecure — the TLS branch is commented out and
 * `GrpcDetails.isSecure` is ignored.
 *
 * Note: the `.proto` files are resolved from `src/`, not `dist/`, so gRPC only works when the published
 * package still ships its sources. See `docs/known-issues.md`.
 */
export class GrpcClientFactory {
    _manager;
    _logger;
    _endpoint;
    _serviceDef;
    _creds;
    _clients = new Array();
    // private readonly _disposableClients = new Array<GrpcClientInternal>();
    _roundRobin = 0;
    constructor(manager) {
        given(manager, "manager").ensureHasValue().ensureIsInstanceOf(EdaManager)
            .ensure(t => t.grpcProxyEnabled, "GRPC proxy not enabled");
        this._manager = manager;
        this._logger = this._manager.serviceLocator.resolve("Logger");
        this._endpoint = `${this._manager.grpcDetails.host}:${this._manager.grpcDetails.port}`;
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
        // FIXME: might need this to work in aws
        // let isSecure = this._manager.grpcDetails!.host !== "localhost";
        // if (this._manager.grpcDetails!.isSecure != null)
        //     isSecure = this._manager.grpcDetails!.isSecure!;
        // if (isSecure)
        // {
        //     const creds = Grpc.credentials.createSsl();
        //     const origConnectionOptions = creds._createSecureConnector().bind(creds);
        //     creds._getConnectionOptions = function (): ConnectionOptions
        //     {
        //         const connOptions = origConnectionOptions()!;
        //         connOptions.rejectUnauthorized = false;
        //         return connOptions;
        //     };
        //     this._creds = creds;
        //     console.log("SECURE GRPC CREDENTIALS CREATED");
        // }
        // else
        // {
        //     this._creds = Grpc.credentials.createInsecure();
        //     console.log("INSECURE GRPC CREDENTIALS CREATED");
        // }
        this._creds = Grpc.credentials.createInsecure();
        let connectionPoolSize = this._manager.grpcDetails.connectionPoolSize ?? 50;
        if (connectionPoolSize <= 0)
            connectionPoolSize = 50;
        Make.loop(() => this._clients.push(new GrpcClientFacade(new GrpcClientInternal(this._endpoint, this._serviceDef, this._creds, this._logger))), connectionPoolSize);
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
    create() {
        if (this._roundRobin >= this._clients.length)
            this._roundRobin = 0;
        const client = this._clients[this._roundRobin];
        this._roundRobin++;
        return client;
    }
}
class GrpcClientInternal {
    _id = Uuid.create();
    _createdAt = Date.now();
    _client;
    _logger;
    _numInvocations = 0;
    _activeInvocations = 0;
    _isDisposing = false;
    _isDisposed = false;
    get id() { return this._id; }
    get isStale() { return (this._createdAt + Duration.fromMinutes(10).toMilliSeconds()) < Date.now(); }
    get isOverused() { return this._numInvocations > 1000; }
    get isActive() { return this._activeInvocations > 0; }
    get isDisposed() { return this._isDisposed; }
    constructor(endpoint, serviceDef, creds, logger) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        this._client = new serviceDef.EdaService(endpoint, creds);
        this._logger = logger;
    }
    process(workItem) {
        if (this._isDisposing)
            throw new ApplicationException("Using disposed client");
        return new Promise((resolve, reject) => {
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
            (err, response) => {
                this._activeInvocations--;
                if (err)
                    reject(err);
                else
                    resolve(response);
            });
        });
    }
    async dispose() {
        if (this._isDisposing || this._isDisposed)
            return;
        try {
            this._isDisposing = true;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            this._client.close();
        }
        catch (error) {
            await this._logger.logWarning("Error while closing GRPC client");
            await this._logger.logError(error);
        }
        finally {
            this._isDisposed = true;
        }
    }
}
class GrpcClientFacade {
    _clientInternal;
    get internal() { return this._clientInternal; }
    constructor(clientInternal) {
        this._clientInternal = clientInternal;
    }
    process(workItem) {
        return this._clientInternal.process(workItem);
    }
    swap(clientInternal) {
        this._clientInternal = clientInternal;
    }
}
//# sourceMappingURL=grpc-client-factory.js.map