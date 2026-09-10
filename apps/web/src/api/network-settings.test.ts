import { describe, expect, it, vi } from "vitest";

import { getNetworkSettings, updateNetworkSettings } from "./network-settings";

const routeStatus = {
  settings: {
    mode: "auto" as const,
    proxyProtocol: "http" as const,
    proxyHost: "127.0.0.1",
    proxyPort: 7897,
  },
  activeRoute: "direct" as const,
  candidateProxyUrl: "http://127.0.0.1:7897",
  proxyReachable: false,
  proxySource: "system" as const,
};

describe("网络设置 API Client", () => {
  it("读取当前网络线路", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(routeStatus), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(getNetworkSettings(fetcher)).resolves.toEqual(routeStatus);
    expect(fetcher).toHaveBeenCalledWith("/api/settings/network", {
      headers: { accept: "application/json" },
    });
  });

  it("保存用户选择的线路配置", async () => {
    const nextStatus = {
      ...routeStatus,
      settings: { ...routeStatus.settings, mode: "direct" as const },
      candidateProxyUrl: null,
      proxySource: null,
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(nextStatus), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(updateNetworkSettings(nextStatus.settings, fetcher)).resolves.toEqual(nextStatus);
    expect(fetcher).toHaveBeenCalledWith("/api/settings/network", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify(nextStatus.settings),
    }));
  });
});
