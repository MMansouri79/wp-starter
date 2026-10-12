import { AsyncLocalStorage } from "node:async_hooks";

/** Serializes asynchronous mutations while allowing nested calls in the same operation. */
export class MutationLock {
  private readonly context = new AsyncLocalStorage<{ active: boolean }>();
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.context.getStore()?.active) return work();
    const next = this.tail.then(() => this.context.run({ active: true }, async () => {
      const state = this.context.getStore()!;
      try { return await work(); }
      finally { state.active = false; }
    }));
    this.tail = next.catch(() => undefined);
    return next;
  }
}
