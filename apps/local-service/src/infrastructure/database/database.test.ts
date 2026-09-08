import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "./database.js";
import { databaseMigrations } from "./migrations.js";

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

    expect(database.schemaVersion).toBe(14);
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

    expect(migrationCount).toEqual({ count: 14 });
    reopenedDatabase.close();
  });

  it("从 schema 6 升级时保留 Revision 并回填 Source Mapping", () => {
    const directory = mkdtempSync(join(tmpdir(), "lumen-database-upgrade-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "lumen.db");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    for (const migration of databaseMigrations.filter((item) => item.version <= 6)) {
      legacy.exec(migration.sql);
      legacy.prepare(`
        INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (?, ?, '2026-09-07T00:00:00.000Z')
      `).run(migration.version, migration.name);
    }
    legacy.prepare(`
      INSERT INTO documents (id, format_id, title, status, created_at, updated_at)
      VALUES ('document-legacy', 'markdown', 'Legacy', 'unavailable', ?, ?)
    `).run("2026-09-07T00:00:00.000Z", "2026-09-07T00:00:00.000Z");
    legacy.prepare(`
      INSERT INTO document_revisions (
        id, document_id, content_hash, status, adapter_version,
        semantic_projection_version, render_projection_version,
        source_mapping_version, created_at
      ) VALUES (
        'revision-legacy', 'document-legacy', 'hash-legacy', 'ready',
        'markdown.adapter.v1', 'markdown.semantic.v1',
        'markdown.render.v1', 'markdown.source-map.v1', ?
      )
    `).run("2026-09-07T00:00:00.000Z");
    legacy.prepare(`
      INSERT INTO semantic_blocks (
        id, revision_id, block_type, block_order, text,
        source_start_offset, source_end_offset
      ) VALUES ('block-legacy', 'revision-legacy', 'paragraph', 0, 'Legacy text', 12, 23)
    `).run();
    legacy.close();

    const upgraded = openDatabase(databasePath);

    expect(upgraded.schemaVersion).toBe(14);
    expect(upgraded.connection.prepare(`
      SELECT block_id, semantic_start_offset, semantic_end_offset,
        source_start_offset, source_end_offset
      FROM source_mappings WHERE revision_id = 'revision-legacy'
    `).get()).toEqual({
      block_id: "block-legacy",
      semantic_start_offset: 0,
      semantic_end_offset: 11,
      source_start_offset: 12,
      source_end_offset: 23,
    });
    expect(upgraded.connection.prepare(`
      SELECT json_extract(capabilities_snapshot, '$.payload.selectableText') AS selectable
      FROM document_revisions WHERE id = 'revision-legacy'
    `).get()).toEqual({ selectable: 1 });
    upgraded.close();
  });
});
