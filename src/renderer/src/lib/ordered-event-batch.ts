/** Coalesce delivery, not semantics: every event is folded once, in arrival order. */
export class OrderedEventBatch<T> {
  #events: T[] = [];
  #cancel?: () => void;
  constructor(readonly publish: (events: readonly T[]) => void, readonly schedule: (flush: () => void) => () => void) {}
  push(event: T): void {
    this.#events.push(event);
    this.#cancel ??= this.schedule(() => this.flush());
  }
  flush(): void {
    this.#cancel?.();
    this.#cancel = undefined;
    if (this.#events.length === 0) return;
    const events = this.#events;
    this.#events = [];
    this.publish(events);
  }
  dispose(): void {
    this.#cancel?.();
    this.#cancel = undefined;
    this.#events = [];
  }
}
