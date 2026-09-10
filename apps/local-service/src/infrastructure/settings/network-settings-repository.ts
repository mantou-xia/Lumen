import type { DatabaseSync } from "node:sqlite";

import type { NetworkSettings } from "@lumen/api-contract";

const settingsKey = "settings.network.outbound";

export const defaultNetworkSettings: NetworkSettings = {
  mode: "auto",
  proxyProtocol: "http",
  proxyHost: "127.0.0.1",
  proxyPort: 7897,
};

export class NetworkSettingsRepository {
  constructor(private readonly connection: DatabaseSync) {}

  get(): NetworkSettings {
    const row = this.connection
      .prepare("SELECT value FROM application_metadata WHERE key = ?")
      .get(settingsKey) as { value?: unknown } | undefined;
    if (typeof row?.value !== "string") return defaultNetworkSettings;

    try {
      const parsed = JSON.parse(row.value) as Partial<NetworkSettings>;
      if (
        (parsed.mode === "auto" || parsed.mode === "direct" || parsed.mode === "manual") &&
        (parsed.proxyProtocol === "http" || parsed.proxyProtocol === "https") &&
        typeof parsed.proxyHost === "string" && parsed.proxyHost.length > 0 &&
        Number.isInteger(parsed.proxyPort) &&
        (parsed.proxyPort ?? 0) >= 1 && (parsed.proxyPort ?? 0) <= 65_535
      ) {
        return parsed as NetworkSettings;
      }
    } catch {
      // 损坏的本地设置不能阻止服务启动，回退到稳定默认值。
    }
    return defaultNetworkSettings;
  }

  save(settings: NetworkSettings, updatedAt: string): void {
    this.connection.prepare(`
      INSERT INTO application_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(settingsKey, JSON.stringify(settings), updatedAt);
  }
}
