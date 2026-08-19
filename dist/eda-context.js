import { given } from "@nivinjoseph/n-defensive";
/**
 * The framework's `EdaContext` implementation, registered scoped as `"EdaContext"` by the `EdaManager`
 * constructor and populated per event by `RedisEventSubMgr.onEventReceived`.
 *
 * Note: internal. Depend on the {@link EdaContext} interface; this class is not exported from the barrel.
 */
export class DefaultEdaContext {
    _topic = null;
    /**
     * The topic that delivered the current event.
     *
     * @throws if the topic has not been set for this scope
     */
    get topic() {
        given(this, "this").ensure(t => t._topic != null, "topic not set");
        return this._topic;
    }
    /**
     * Sets the delivering topic. Called once per event by the subscription manager; the value is trimmed.
     *
     * @param value - the topic name
     */
    set topic(value) {
        given(value, "topic").ensureHasValue().ensureIsString();
        this._topic = value.trim();
    }
}
//# sourceMappingURL=eda-context.js.map