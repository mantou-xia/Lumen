import { describe, expect, it } from "vitest";

import {
  createOutboundHttpClient,
  normalizeProxyUrl,
  resolveOutboundProxy,
} from "./outbound-http.js";

describe("外部 HTTP 代理", () => {
  it("显式 Lumen 配置优先于通用代理和 Windows 用户代理", () => {
    expect(resolveOutboundProxy({
      LUMEN_HTTPS_PROXY: "127.0.0.1:7897",
      HTTPS_PROXY: "http://127.0.0.1:8080",
    }, "win32", () => "http://127.0.0.1:9000")).toBe("http://127.0.0.1:7897");
  });

  it("Windows 未显式配置时读取当前用户代理", () => {
    expect(resolveOutboundProxy({}, "win32", () => "http://127.0.0.1:7897"))
      .toBe("http://127.0.0.1:7897");
    expect(resolveOutboundProxy({}, "linux", () => "http://127.0.0.1:7897"))
      .toBeNull();
  });

  it("支持 Windows 按协议保存的代理地址", () => {
    expect(normalizeProxyUrl("http=127.0.0.1:8080;https=127.0.0.1:7897"))
      .toBe("http://127.0.0.1:7897");
  });

  it("无代理时保留原生 fetch", async () => {
    const client = createOutboundHttpClient(null);
    expect(client.fetch).toBe(fetch);
    await client.close();
  });
});
