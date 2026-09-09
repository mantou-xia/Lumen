import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { databaseMigrations } from "./migrations.js";

export interface LumenDatabase {
  connection: DatabaseSync;
  schemaVersion: number;
  transaction<T>(work: () => T): T;
  close(): void;
}

function prepareDatabasePath(databasePath: string): void {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
}

function initializeMigrationTable(connection: DatabaseSync): void {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
}

function getSchemaVersion(connection: DatabaseSync): number {
  const row = connection
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .get();

  if (row === undefined || typeof row.version !== "number") {
    throw new Error("无法读取数据库迁移版本");
  }

  return row.version;
}

function applyMigrations(connection: DatabaseSync): number {
  initializeMigrationTable(connection);
  let currentVersion = getSchemaVersion(connection);

  for (const migration of databaseMigrations) {
    if (migration.version <= currentVersion) {
      continue;
    }

    if (migration.disableForeignKeys === true) {
      connection.exec("PRAGMA foreign_keys = OFF");
    }
    connection.exec("BEGIN IMMEDIATE");
    try {
      connection.exec(migration.sql);
      if (migration.disableForeignKeys === true) {
        const violations = connection.prepare("PRAGMA foreign_key_check").all();
        if (violations.length > 0) {
          throw new Error(`数据库迁移 ${migration.version} 产生了外键不一致`);
        }
      }
      connection
        .prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
        )
        .run(migration.version, migration.name);
      connection.exec("COMMIT");
      if (migration.disableForeignKeys === true) {
        connection.exec("PRAGMA foreign_keys = ON");
      }
      currentVersion = migration.version;
    } catch (error) {
      if (connection.isTransaction) connection.exec("ROLLBACK");
      if (migration.disableForeignKeys === true) {
        connection.exec("PRAGMA foreign_keys = ON");
      }
      throw error;
    }
  }

  return currentVersion;
}

export function openDatabase(databasePath: string): LumenDatabase {
  prepareDatabasePath(databasePath);

  const connection = new DatabaseSync(databasePath);
  connection.exec("PRAGMA foreign_keys = ON");
  if (databasePath !== ":memory:") {
    connection.exec("PRAGMA journal_mode = WAL");
  }

  const schemaVersion = applyMigrations(connection);

  return {
    connection,
    schemaVersion,
    transaction: <T>(work: () => T): T => {
      connection.exec("BEGIN IMMEDIATE");
      try {
        const result = work();
        connection.exec("COMMIT");
        return result;
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => connection.close(),
  };
}
