import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, type LumenDatabase } from "../database/database.js";
import {
  defaultNetworkSettings,
  NetworkSettingsRepository,
} from "./network-settings-repository.js";

let database: LumenDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe("NetworkSettingsRepository", () => {
  it("没有持久化值时返回稳定默认配置", () => {
    database = openDatabase(":memory:");
    const repository = new NetworkSettingsRepository(database.connection);

    expect(repository.get()).toEqual(defaultNetworkSettings);
  });

  it("保存并覆盖网络设置", () => {
    database = openDatabase(":memory:");
    const repository = new NetworkSettingsRepository(database.connection);

    repository.save({
      mode: "manual",
      proxyProtocol: "https",
      proxyHost: "localhost",
      proxyPort: 8899,
    }, "2026-09-10T04:00:00.000Z");
    expect(repository.get()).toEqual({
      mode: "manual",
      proxyProtocol: "https",
      proxyHost: "localhost",
      proxyPort: 8899,
    });

    repository.save({ ...defaultNetworkSettings, mode: "direct" }, "2026-09-10T04:01:00.000Z");
    expect(repository.get()).toEqual({ ...defaultNetworkSettings, mode: "direct" });
  });

  it("损坏的本地值回退到默认配置", () => {
    database = openDatabase(":memory:");
    database.connection.prepare(`
      INSERT INTO application_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run("settings.network.outbound", "{invalid", "2026-09-10T04:00:00.000Z");

    expect(new NetworkSettingsRepository(database.connection).get()).toEqual(defaultNetworkSettings);
  });
});
