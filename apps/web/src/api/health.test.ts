import { describe, expect, it, vi } from "vitest";

import { getHealth, waitForHealth } from "./health";

describe("getHealth", () => {
  it("校验并返回健康状态", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: "ok",
          service: "lumen-local-service",
          version: "0.1.0",
          database: { status: "ready", schemaVersion: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(getHealth(fetcher)).resolves.toMatchObject({
      status: "ok",
      database: { schemaVersion: 1 },
    });
    expect(fetcher).toHaveBeenCalledWith("/api/health", {
      headers: { accept: "application/json" },
    });
  });

  it("将非成功响应转换为明确错误", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));

    await expect(getHealth(fetcher)).rejects.toThrow("HTTP 503");
  });

  it("端口被其他程序占用时不把二进制响应显示为 JSON 乱码", async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([0xff, 0xfe, 0xfd]), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    }));

    await expect(getHealth(fetcher)).rejects.toThrow("端口返回了非 JSON 内容");
  });

  it("启动期间遇到临时 502 时重试到 Local Service 就绪", async () => {
    let attempt = 0;
    const fetcher = vi.fn(async () => {
      attempt += 1;
      if (attempt < 3) return new Response(null, { status: 502 });
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "lumen-local-service",
          version: "0.1.0",
          database: { status: "ready", schemaVersion: 6 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await expect(waitForHealth(fetcher, { maxAttempts: 3, retryDelayMilliseconds: 0 }))
      .resolves.toMatchObject({ status: "ok", database: { schemaVersion: 6 } });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("达到重试上限后返回最后一次健康检查错误", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 502 }));

    await expect(waitForHealth(fetcher, { maxAttempts: 2, retryDelayMilliseconds: 0 }))
      .rejects.toThrow("HTTP 502");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
