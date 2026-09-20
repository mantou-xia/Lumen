import type { DailyReadingApplication } from "./daily-reading-application.js";

export class DailyReadingScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly application: DailyReadingApplication) {}

  start(): void {
    this.application.interruptRunning();
    try { this.application.runDue("startup_catchup"); } catch { /* 下个周期继续尝试 */ }
    this.timer = setInterval(() => {
      try { this.application.runDue("scheduled"); } catch { /* 单次失败不能终止服务 */ }
    }, 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
