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