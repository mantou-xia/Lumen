import { describe, expect, it } from "vitest";

import { localDateAt, nextScheduledAt } from "./daily-reading-application.js";

describe("daily reading time", () => {
  it("按配置时区计算本地自然日", () => {
    expect(localDateAt(new Date("2026-09-11T16:30:00.000Z"), "Asia/Shanghai"))
      .toBe("2026-09-12");
  });

  it("当天时间已过时计划到下一本地自然日", () => {
    expect(nextScheduledAt(
      new Date("2026-09-12T01:00:00.000Z"),
      "08:00",
      "Asia/Shanghai",
    )).toBe("2026-09-13T00:00:00.000Z");
  });
});
