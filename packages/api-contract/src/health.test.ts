import { describe, expect, it } from "vitest";

import { healthResponseSchema } from "./health.js";

describe("healthResponseSchema", () => {
  it("接受有效的 Local Service 健康状态", () => {
    const result = healthResponseSchema.parse({
      status: "ok",
      service: "lumen-local-service",
      version: "0.1.0",
      database: {
        status: "ready",
        schemaVersion: 1,
      },
    });

    expect(result.database.schemaVersion).toBe(1);
  });

  it("拒绝缺少数据库状态的响应", () => {
    expect(() =>
      healthResponseSchema.parse({
        status: "ok",
        service: "lumen-local-service",
        version: "0.1.0",
      }),
    ).toThrow();
  });
});
