/**
 * Send-side sampler. Coalesces rapid updates into a fixed cadence.
 * Renders local state immediately; only network sends are throttled.
 */
export class SendThrottler {
  private lastSentAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: (() => void) | null = null;
  private readonly intervalMs: number;

  constructor(intervalMs = 40) {
    this.intervalMs = intervalMs;
  }

  /** Schedule `fn` to run at most once per interval. */
  schedule(fn: () => void): void {
    this.pending = fn;
    if (this.timer) return;
    const now = Date.now();
    const wait = Math.max(0, this.intervalMs - (now - this.lastSentAt));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.lastSentAt = Date.now();
      const p = this.pending;
      this.pending = null;
      if (p) p();
    }, wait);
  }

  flushNow(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const p = this.pending;
    this.pending = null;
    if (p) {
      this.lastSentAt = Date.now();
      p();
    }
  }

  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
  }

  getHz(): number {
    return Math.round(1000 / this.intervalMs);
  }
}
