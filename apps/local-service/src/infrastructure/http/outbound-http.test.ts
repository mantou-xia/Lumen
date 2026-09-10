import { describe, expect, it } from "vitest";

import {
  createOutboundHttpClient,
  normalizeProxyUrl,
  resolveOutboundProxy,
  resolveOutboundRoute,
} from "./outbound-http.js";

const defaultSettings = {
  mode: "auto" as const,
  proxyProtocol: "http" as const,
  proxyHost: "127.0.0.1",
  proxyPort: 7897,
};

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

  it("自动模式仅在候选代理端口可连接时使用代理", async () => {
    const available = await resolveOutboundRoute(defaultSettings, {
      environment: {},
      platform: "win32",
      readWindowsProxy: () => "http://127.0.0.1:7897",
      isProxyReachable: async () => true,
    });
    const unavailable = await resolveOutboundRoute(defaultSettings, {
      environment: {},
      platform: "win32",
      readWindowsProxy: () => "http://127.0.0.1:7897",
      isProxyReachable: async () => false,
    });

    expect(available.activeRoute).toBe("proxy");
    expect(unavailable.activeRoute).toBe("direct");
    expect(unavailable.candidateProxyUrl).toBe("http://127.0.0.1:7897");
  });

  it("直连模式忽略环境变量和系统代理", async () => {
    const route = await resolveOutboundRoute({ ...defaultSettings, mode: "direct" }, {
      environment: { HTTPS_PROXY: "http://127.0.0.1:8080" },
      platform: "win32",
      readWindowsProxy: () => "http://127.0.0.1:7897",
      isProxyReachable: async () => true,
    });
    expect(route).toMatchObject({
      activeRoute: "direct",
      candidateProxyUrl: null,
      proxySource: null,
    });
  });

  it("手动模式使用用户配置且不因探测失败改为直连", async () => {
    const route = await resolveOutboundRoute({
      mode: "manual",
      proxyProtocol: "http",
      proxyHost: "localhost",
      proxyPort: 8899,
    }, { isProxyReachable: async () => false });
    expect(route).toMatchObject({
      activeRoute: "proxy",
      candidateProxyUrl: "http://localhost:8899",
      proxyReachable: false,
      proxySource: "manual",
    });
  });

  it("无可用代理时由动态客户端保留直连线路", async () => {
    const client = createOutboundHttpClient(() => defaultSettings, {
      environment: {},
      platform: "linux",
    });
    await expect(client.getRouteStatus()).resolves.toMatchObject({ activeRoute: "direct" });
    await client.close();
  });
});
