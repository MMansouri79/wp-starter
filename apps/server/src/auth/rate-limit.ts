/**
 * Fixed-window throttling for sign-in and invite-code redemption.
 *
 * Counters live in this process only: they do not survive a restart and are not
 * shared between replicas. That matches the single-process deployment this
 * server targets; put a shared limiter (or the reverse proxy) in front of it
 * before running more than one instance.
 */
export interface LoginRateLimitOptions {
  /** Failed attempts allowed inside one window before the lockout starts. */
  maxAttempts: number;
  /** Window length in seconds; a lockout lasts until the window expires. */
  lockoutSeconds: number;
}

interface Counter {
  failures: number;
  windowStartedAt: number;
}

/** Keeps the map bounded when many distinct addresses or emails fail. */
const PRUNE_THRESHOLD = 1000;

export class LoginRateLimiter {
  private readonly counters = new Map<string, Counter>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(options: LoginRateLimitOptions) {
    this.maxAttempts = Math.max(1, options.maxAttempts);
    this.windowMs = Math.max(1, options.lockoutSeconds) * 1000;
  }

  /** Seconds the caller must wait, or 0 when the key may attempt again. */
  retryAfterSeconds(key: string): number {
    if (this.counters.size >= PRUNE_THRESHOLD) {
      this.prune(Date.now());
      if (!this.counters.has(key) && this.counters.size >= PRUNE_THRESHOLD) return 1;
    }
    const counter = this.counters.get(key);
    if (!counter || counter.failures < this.maxAttempts) return 0;

    const remaining = counter.windowStartedAt + this.windowMs - Date.now();
    if (remaining <= 0) {
      this.counters.delete(key);
      return 0;
    }
    return Math.ceil(remaining / 1000);
  }

  /** Counts one failed attempt and starts a fresh window when the old one lapsed. */
  recordFailure(key: string): void {
    const now = Date.now();
    const counter = this.counters.get(key);

    if (!counter || now - counter.windowStartedAt >= this.windowMs) {
      if (this.counters.size >= PRUNE_THRESHOLD) this.prune(now);
      if (this.counters.size >= PRUNE_THRESHOLD && !counter) return;
      this.counters.set(key, { failures: 1, windowStartedAt: now });
      return;
    }

    counter.failures += 1;
  }

  /** A successful attempt clears the key's failures. */
  clear(key: string): void {
    this.counters.delete(key);
  }

  private prune(now: number): void {
    for (const [key, counter] of this.counters) {
      if (now - counter.windowStartedAt >= this.windowMs) this.counters.delete(key);
    }
  }
}
