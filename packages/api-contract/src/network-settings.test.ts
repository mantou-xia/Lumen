import { describe, expect, it } from "vitest";

import {
  networkRouteStatusSchema,
  updateNetworkSettingsRequestSchema,
} from "./network-settings.js";

describe("网络设置协议", () => {
  it("接受三种线路模式和有效代理端口", () => {
    expect(updateNetworkSettingsRequestSchema.parse({
      mode: "manual",
      proxyProtocol: "http",
      proxyHost: "127.0.0.1",
      proxyPort: 7897,
    })).toEqual({
      mode: "manual",
      proxyProtocol: "http",
      proxyHost: "127.0.0.1",
      proxyPort: 7897,
    });
  });

  it("拒绝无效端口", () => {
    expect(() => updateNetworkSettingsRequestSchema.parse({
      mode: "auto",
      proxyProtocol: "http",
      proxyHost: "127.0.0.1",
      proxyPort: 0,
    })).toThrow();
  });

  it("校验当前实际线路状态", () => {
    expect(networkRouteStatusSchema.parse({
      settings: {
        mode: "auto",
        proxyProtocol: "http",
        proxyHost: "127.0.0.1",
        proxyPort: 7897,
      },
      activeRoute: "direct",
      candidateProxyUrl: "http://127.0.0.1:7897",
      proxyReachable: false,
      proxySource: "system",
    }).activeRoute).toBe("direct");
  });
});
