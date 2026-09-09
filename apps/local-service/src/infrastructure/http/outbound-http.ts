import { execFileSync } from "node:child_process";

import { fetch as undiciFetch, ProxyAgent } from "undici";

const windowsInternetSettings = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`;

export interface OutboundHttpClient {
  fetch: typeof fetch;
  proxyUrl: string | null;
  close(): Promise<void>;
}

export function resolveOutboundProxy(
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  readWindowsProxy: () => string | null = readWindowsUserProxy,
): string | null {
  const configured = [
    environment.LUMEN_HTTPS_PROXY,
    environment.HTTPS_PROXY,
    environment.ALL_PROXY,
  ].find((value) => value?.trim());
  if (configured !== undefined) return normalizeProxyUrl(configured);
  return platform === "win32" ? readWindowsProxy() : null;
}

export function createOutboundHttpClient(proxyUrl: string | null): OutboundHttpClient {
  if (proxyUrl === null) {
    return {
      fetch,
      proxyUrl: null,
      close: async () => undefined,
    };
  }
  const dispatcher = new ProxyAgent(proxyUrl);
  const proxyFetch = ((input: RequestInfo | URL, init?: RequestInit) => (
    undiciFetch(
      input as unknown as Parameters<typeof undiciFetch>[0],
      { ...init, dispatcher } as Parameters<typeof undiciFetch>[1],
    ) as unknown as Promise<Response>
  )) as typeof fetch;
  return {
    fetch: proxyFetch,
    proxyUrl,
    close: () => dispatcher.close(),
  };
}

export function normalizeProxyUrl(value: string): string {
  const proxy = selectProxyAddress(value.trim());
  const normalized = /^[a-z][a-z\d+.-]*:\/\//iu.test(proxy) ? proxy : `http://${proxy}`;
  const url = new URL(normalized);
  if (url.hostname.length === 0 || url.port.length === 0) {
    throw new Error("外部 HTTP 代理必须包含主机和端口");
  }
  return url.toString().replace(/\/$/u, "");
}

function selectProxyAddress(value: string): string {
  if (!value.includes("=")) return value;
  const entries = new Map(value.split(";").flatMap((entry) => {
    const separator = entry.indexOf("=");
    if (separator < 1) return [];
    return [[entry.slice(0, separator).trim().toLocaleLowerCase("en-US"), entry.slice(separator + 1).trim()]];
  }));
  return entries.get("https") ?? entries.get("http") ?? value;
}

function readWindowsUserProxy(): string | null {
  try {
    const enabled = queryWindowsRegistryValue("ProxyEnable");
    if (enabled === null || Number.parseInt(enabled, 16) !== 1) return null;
    const server = queryWindowsRegistryValue("ProxyServer");
    return server === null ? null : normalizeProxyUrl(server);
  } catch {
    return null;
  }
}

function queryWindowsRegistryValue(name: string): string | null {
  const output = execFileSync(
    "reg.exe",
    ["query", windowsInternetSettings, "/v", name],
    { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
  );
  const line = output.split(/\r?\n/u).find((item) => item.trimStart().startsWith(name));
  return line?.trim().split(/\s{2,}/u).at(-1) ?? null;
}
