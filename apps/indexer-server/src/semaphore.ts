/**
 * A minimal counting semaphore for bounding concurrency (e.g. the number of
 * simultaneous Claude CLI subprocesses). FIFO: waiters acquire in arrival order.
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    if (permits < 1) throw new Error('Semaphore requires at least 1 permit');
    this.available = permits;
  }

  private acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the permit directly to the next waiter (count stays at 0).
      next();
    } else {
      this.available += 1;
    }
  }

  /** Run `fn` while holding a permit; always releases, even on rejection. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
