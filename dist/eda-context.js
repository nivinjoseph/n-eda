import { given } from "@nivinjoseph/n-defensive";
export class DefaultEdaContext {
    constructor() {
        this._topic = null;
    }
    get topic() {
        given(this, "this").ensure(t => t._topic != null, "topic not set");
        return this._topic;
    }
    set topic(value) {
        given(value, "topic").ensureHasValue().ensureIsString();
        this._topic = value.trim();
    }
}
//# sourceMappingURL=eda-context.js.map