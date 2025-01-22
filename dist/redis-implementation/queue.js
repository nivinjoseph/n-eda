export class Queue {
    get isEmpty() { return this._first === null; }
    get peek() { var _a, _b; return (_b = (_a = this._first) === null || _a === void 0 ? void 0 : _a.item) !== null && _b !== void 0 ? _b : null; }
    get length() { return this._length; }
    constructor(items) {
        this._first = null;
        this._last = null;
        this._length = 0;
        items === null || items === void 0 ? void 0 : items.forEach(t => this.enqueue(t));
    }
    enqueue(item) {
        const node = {
            item,
            next: null
        };
        if (this._last !== null)
            this._last.next = node;
        this._last = node;
        if (this._first === null)
            this._first = node;
        this._length++;
    }
    dequeue() {
        const node = this._first;
        let item = null;
        if (node !== null) {
            this._first = node.next;
            item = node.item;
            this._length--;
        }
        if (this._first === null)
            this._last = null;
        return item;
    }
}
//# sourceMappingURL=queue.js.map