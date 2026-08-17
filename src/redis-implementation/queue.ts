/**
 * A circular-buffer FIFO queue with amortized O(1) enqueue and dequeue.
 *
 * Note: internal. Used for the scheduler's per-partition-key work queues, where the array-shift cost of a
 * naive queue would show up under load.
 *
 * @typeParam T - the element type
 */
export class Queue<T>
{
    private _first: QueueNode<T> | null = null;
    private _last: QueueNode<T> | null = null;
    private _length = 0;


    public get isEmpty(): boolean { return this._first === null; }
    public get peek(): T | null { return this._first?.item ?? null; }
    public get length(): number { return this._length; }

    
    public constructor(items?: ReadonlyArray<T>)
    {
        items?.forEach(t => this.enqueue(t));
    }


    public enqueue(item: T): void
    {
        const node: QueueNode<T> = {
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

    public dequeue(): T | null
    {
        const node = this._first;

        let item: T | null = null;

        if (node !== null)
        {
            this._first = node.next;
            item = node.item;
            this._length--;
        }

        if (this._first === null)
            this._last = null;

        return item;
    }
}

interface QueueNode<T>
{
    item: T;
    next: QueueNode<T> | null;
}