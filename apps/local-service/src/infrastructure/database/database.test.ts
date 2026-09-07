import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "./database.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("openDatabase", () => {
  it("在全新数据目录执行初始迁移", () => {
    const directory = mkdtempSync(join(tmpdir(), "lumen-database-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "lumen.db");

    const database = openDatabase(databasePath);

    expect(database.schemaVersion).toBe(6);
    expect(
      database.connection.prepare("SELECT value FROM application_metadata WHERE key = ?").get("application"),
    ).toEqual({ value: "lumen" });
    database.close();
    expect(readFileSync(databasePath).subarray(0, 15).toString()).toBe("SQLite format 3");
  });

  it("重复启动时不会重复执行已应用迁移", () => {
    const directory = mkdtempSync(join(tmpdir(), "lumen-database-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "lumen.db");

    openDatabase(databasePath).close();
    const reopenedDatabase = openDatabase(databasePath);
    const migrationCount = reopenedDatabase.connection
      .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
      .get();

    expect(migrationCount).toEqual({ count: 6 });
    reopenedDatabase.close();
  });
});
