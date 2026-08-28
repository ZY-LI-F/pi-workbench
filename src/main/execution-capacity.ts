export const DEFAULT_EXECUTION_CONCURRENCY = 3;
export const MAX_EXECUTION_CONCURRENCY = 16;

export interface ExecutionCapacityLease {
  readonly ownerId: string;
  release(): void;
}

interface CapacityWaiter {
  readonly ownerId: string;
  readonly signal?: AbortSignal;
  readonly resolve: (lease: ExecutionCapacityLease) => void;
  readonly reject: (cause: Error) => void;
  readonly onAbort?: () => void;
}

export class ExecutionCapacityAbortError extends Error {
  constructor(message = "执行容量等待已取消") {
    super(message);
    this.name = "ExecutionCapacityAbortError";
  }
}

export function executionConcurrencyFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = environment.STELLA_EXECUTION_CONCURRENCY?.trim();
  if (!raw) return DEFAULT_EXECUTION_CONCURRENCY;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_EXECUTION_CONCURRENCY) {
    throw new Error(`STELLA_EXECUTION_CONCURRENCY 必须是 1-${MAX_EXECUTION_CONCURRENCY} 的整数`);
  }
  return parsed;
}

/** Application-wide FIFO semaphore shared by every managed execution surface. */
export class ExecutionCapacity {
  readonly #limit: number;
  readonly #active = new Set<string>();
  readonly #waiters: CapacityWaiter[] = [];

  constructor(limit = DEFAULT_EXECUTION_CONCURRENCY) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EXECUTION_CONCURRENCY) {
      throw new Error(`执行并发上限必须是 1-${MAX_EXECUTION_CONCURRENCY} 的整数`);
    }
    this.#limit = limit;
  }

  get limit(): number { return this.#limit; }
  get activeCount(): number { return this.#active.size; }
  get waitingCount(): number { return this.#waiters.length; }

  acquire(ownerId: string, signal?: AbortSignal): Promise<ExecutionCapacityLease> {
    if (!ownerId.trim()) return Promise.reject(new Error("Execution capacity ownerId 不能为空"));
    if (signal?.aborted) return Promise.reject(new ExecutionCapacityAbortError());
    if (this.#active.has(ownerId) || this.#waiters.some((waiter) => waiter.ownerId === ownerId)) {
      return Promise.reject(new Error(`Execution capacity owner ${ownerId} 已在 active/waiting 集合中`));
    }
    if (this.#active.size < this.#limit && this.#waiters.length === 0) {
      this.#active.add(ownerId);
      return Promise.resolve(this.#lease(ownerId));
    }
    return new Promise<ExecutionCapacityLease>((resolve, reject) => {
      const waiter: CapacityWaiter = {
        ownerId,
        signal,
        resolve,
        reject,
        onAbort: signal ? () => {
          const index = this.#waiters.indexOf(waiter);
          if (index < 0) return;
          this.#waiters.splice(index, 1);
          reject(new ExecutionCapacityAbortError());
        } : undefined,
      };
      if (waiter.onAbort) signal?.addEventListener("abort", waiter.onAbort, { once: true });
      this.#waiters.push(waiter);
    });
  }

  #lease(ownerId: string): ExecutionCapacityLease {
    let released = false;
    return Object.freeze({
      ownerId,
      release: () => {
        if (released) return;
        released = true;
        if (!this.#active.delete(ownerId)) return;
        this.#drain();
      },
    });
  }

  #drain(): void {
    while (this.#active.size < this.#limit) {
      const waiter = this.#waiters.shift();
      if (!waiter) return;
      if (waiter.onAbort) waiter.signal?.removeEventListener("abort", waiter.onAbort);
      if (waiter.signal?.aborted) {
        waiter.reject(new ExecutionCapacityAbortError());
        continue;
      }
      this.#active.add(waiter.ownerId);
      waiter.resolve(this.#lease(waiter.ownerId));
    }
  }
}
