/**
 * Runs a refresh after changes settle: requests within `delayMs` of each other are merged, and a
 * request while a refresh runs schedules exactly one more after it ("again" flag), never two at once.
 */
export class Refresher {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private again = false;
  private stopped = false;

  constructor(
    private readonly refresh: () => Promise<void>,
    private readonly delayMs = 300,
  ) {}

  request(): void {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), this.delayMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async run(): Promise<void> {
    this.timer = null;
    this.running = true;
    try {
      await this.refresh();
    } catch (error) {
      console.error('[watch] refresh failed:', error);
    } finally {
      this.running = false;
      if (this.again && !this.stopped) {
        this.again = false;
        this.request();
      }
    }
  }
}
