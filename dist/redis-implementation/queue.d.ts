/**
 * A circular-buffer FIFO queue with amortized O(1) enqueue and dequeue.
 *
 * Note: internal. Used for the scheduler's per-partition-key work queues, where the array-shift cost of a
 * naive queue would show up under load.
 *
 * @typeParam T - the element type
 */
export declare class Queue<T> {
    private _first;
    private _last;
    private _length;
    get isEmpty(): boolean;
    get peek(): T | null;
    get length(): number;
    constructor(items?: ReadonlyArray<T>);
    enqueue(item: T): void;
    dequeue(): T | null;
}
//# sourceMappingURL=queue.d.ts.map