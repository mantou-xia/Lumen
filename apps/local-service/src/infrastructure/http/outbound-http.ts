import { execFileSync } from "node:child_process";
import { createConnection } from "node:net";

import type { NetworkRouteStatus, NetworkSettings } from "@lumen/api-contract";
import { fetch as undiciFetch, ProxyAgent } from "undici";

const windowsInternetSettings = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`;
const proxyProbeTimeoutMilliseconds = 350;

type ProxySource = "environment" | "manual" | "system";

interface ProxyCandidate {
  proxyUrl: string;
  source: ProxySource;
}

export interface OutboundHttpClient {
  fetch: typeof fetch;
  getRouteStatus(): Promise<NetworkRouteStatus>;
  close(): Promise<void>;
}

export interface OutboundHttpOptions {
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  readWindowsProxy?: () => string | null;
  isProxyReachable?: (proxyUrl: string) => Promise<boolean>;
}

export function resolveOutboundProxy(
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  readWindowsProxy: () => string | null = readWindowsUserProxy,
): string | null {
  return resolveAutomaticProxyCandidate(environment, platform, readWindowsProxy)?.proxyUrl ?? null;
}

export async function resolveOutboundRoute(
  settings: NetworkSettings,
  options: OutboundHttpOptions = {},
): Promise<NetworkRouteStatus> {
  if (settings.mode === "direct") {
    return {
      settings,
      activeRoute: "direct",
      candidateProxyUrl: null,
      proxyReachable: false,
      proxySource: null,
    };
  }

  const candidate = settings.mode === "manual"
    ? { proxyUrl: manualProxyUrl(settings), source: "manual" as const }
    : resolveAutomaticProxyCandidate(
        options.environment ?? process.env,
        options.platform ?? process.platform,
        options.readWindowsProxy ?? readWindowsUserProxy,
      );
  if (candidate === null) {
    return {
      settings,
      activeRoute: "direct",
      candidateProxyUrl: null,
      proxyReachable: false,
      proxySource: null,
    };
  }

  const reachable = await (options.isProxyReachable ?? probeProxyPort)(candidate.proxyUrl);
  return {
    settings,
    activeRoute: settings.mode === "manual" || reachable ? "proxy" : "direct",
    candidateProxyUrl: candidate.proxyUrl,
    proxyReachable: reachable,
    proxySource: candidate.source,
  };
}

export function createOutboundHttpClient(
  getSettings: () => NetworkSettings,
  options: OutboundHttpOptions = {},
): OutboundHttpClient {
  const dispatchers = new Map<string, ProxyAgent>();
  const getRouteStatus = () => resolveOutboundRoute(getSettings(), options);
  const routedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const route = await getRouteStatus();
    if (route.activeRoute === "direct" || route.candidateProxyUrl === null) {
      return fetch(input, init);
    }

    let dispatcher = dispatchers.get(route.candidateProxyUrl);
    if (dispatcher === undefined) {
      dispatcher = new ProxyAgent(route.candidateProxyUrl);
      dispatchers.set(route.candidateProxyUrl, dispatcher);
    }
    return undiciFetch(
      input as unknown as Parameters<typeof undiciFetch>[0],
      { ...init, dispatcher } as Parameters<typeof undiciFetch>[1],
    ) as unknown as Promise<Response>;
  }) as typeof fetch;

  return {
    fetch: routedFetch,
    getRouteStatus,
    close: async () => {
      await Promise.all([...dispatchers.values()].map((dispatcher) => dispatcher.close()));
    },
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

function manualProxyUrl(settings: NetworkSettings): string {
  return normalizeProxyUrl(`${settings.proxyProtocol}://${settings.proxyHost}:${settings.proxyPort}`);
}

function resolveAutomaticProxyCandidate(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  readWindowsProxy: () => string | null,
): ProxyCandidate | null {
  const configured = [
    environment.LUMEN_HTTPS_PROXY,
    environment.HTTPS_PROXY,
    environment.ALL_PROXY,
  ].find((value) => value?.trim());
  if (configured !== undefined) {
    return { proxyUrl: normalizeProxyUrl(configured), source: "environment" };
  }
  if (platform !== "win32") return null;
  const proxyUrl = readWindowsProxy();
  return proxyUrl === null ? null : { proxyUrl, source: "system" };
}

function probeProxyPort(proxyUrl: string): Promise<boolean> {
  const url = new URL(proxyUrl);
  const port = Number.parseInt(url.port, 10);
  return new Promise((resolve) => {
    const socket = createConnection({ host: url.hostname, port });
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(proxyProbeTimeoutMilliseconds);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
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
