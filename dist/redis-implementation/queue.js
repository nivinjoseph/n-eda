export class Queue {
    _first = null;
    _last = null;
    _length = 0;
    get isEmpty() { return this._first === null; }
    get peek() { return this._first?.item ?? null; }
    get length() { return this._length; }
    constructor(items) {
        items?.forEach(t => this.enqueue(t));
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