/**
 * Per-event ambient context, giving a handler access to the delivery metadata of the event it is currently
 * processing.
 *
 * Contract: registered **scoped** under the DI key `"EdaContext"` by the `EdaManager` constructor — you
 * never register it yourself. Inject it with `@inject("EdaContext")`. A fresh instance exists per event
 * delivery and is disposed when `handle()` returns.
 *
 * Note: the context is populated only on the in-process Redis consume path. Under the AWS Lambda, RPC, and
 * gRPC consumers nothing sets it, so reading {@link EdaContext.topic} throws.
 *
 * @example
 * ```typescript
 * @event(UserCreatedEvent)
 * @inject("EdaContext")
 * export class UserCreatedEventHandler implements EdaEventHandler<UserCreatedEvent>
 * {
 *     public constructor(private readonly _edaContext: EdaContext) { }
 *
 *     public async handle(event: UserCreatedEvent): Promise<void>
 *     {
 *         console.log(this._edaContext.topic);
 *     }
 * }
 * ```
 */
export interface EdaContext {
    /**
     * The name of the topic that delivered the event currently being handled.
     *
     * @throws if read before the topic has been set — which is always the case under the AWS Lambda, RPC,
     * and gRPC consumers, whose `onEventReceived` hooks are no-ops
     */
    get topic(): string;
}
/**
 * The framework's `EdaContext` implementation, registered scoped as `"EdaContext"` by the `EdaManager`
 * constructor and populated per event by `RedisEventSubMgr.onEventReceived`.
 *
 * Note: internal. Depend on the {@link EdaContext} interface; this class is not exported from the barrel.
 */
export declare class DefaultEdaContext implements EdaContext {
    private _topic;
    /**
     * The topic that delivered the current event.
     *
     * @throws if the topic has not been set for this scope
     */
    get topic(): string;
    /**
     * Sets the delivering topic. Called once per event by the subscription manager; the value is trimmed.
     *
     * @param value - the topic name
     */
    set topic(value: string);
}
//# sourceMappingURL=eda-context.d.ts.map