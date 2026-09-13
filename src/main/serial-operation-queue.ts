/** Serializes short native control-plane operations, never an entire model turn. */
export class SerialOperationQueue {
  #tail: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
