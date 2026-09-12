import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { LibraryRepository } from "../content/library-repository.js";
import { MarkdownDocumentAdapter } from "../content/markdown/markdown-adapter.js";
import { createLibraryApplication } from "../composition-root.js";
import { openDatabase, type LumenDatabase } from "../infrastructure/database/database.js";
import { ManagedFileStore } from "../infrastructure/files/managed-file-store.js";

const temporaryDirectories: string[] = [];
const databases: LumenDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0).reverse()) {
    database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "lumen-library-"));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, "lumen.db"));
  databases.push(database);
  const fileStore = new ManagedFileStore(directory);
  await fileStore.initialize();
  return {
    database,
    fileStore,
    library: createLibraryApplication(database, fileStore),
    repository: new LibraryRepository(database.connection),
  };
}

describe("LibraryApplication", () => {
  it("相同文件名的多次导入使用不同受管资源", async () => {
    const { database, library } = await createFixture();

    const first = await library.importDocument("chapter.md", Readable.from("# First"));
    const second = await library.importDocument("chapter.md", Readable.from("# Second"));
    const resourceRows = database.connection
      .prepare("SELECT storage_key FROM document_resources ORDER BY created_at, id")
      .all() as Array<{ storage_key: string }>;

    expect(library.listDocuments()).toHaveLength(2);
    expect(first.document.documentId).not.toBe(second.document.documentId);
    expect(resourceRows).toHaveLength(2);
    expect(resourceRows[0]?.storage_key).not.toBe(resourceRows[1]?.storage_key);
    expect(resourceRows.every((row) => !row.storage_key.includes("chapter.md"))).toBe(true);
  });

  it("更新文档创建新 Revision，并保留旧 Revision 与投影", async () => {
    const { database, library } = await createFixture();
    const imported = await library.importDocument(
      "chapter.md",
      Readable.from("# Original\n\nFirst version."),
    );
    const originalRevisionId = imported.document.activeRevisionId;

    const updated = await library.updateDocument(
      imported.document.documentId,
      "chapter.md",
      Readable.from("# Updated\n\nSecond version."),
    );

    expect(updated.operation.kind).toBe("revision_update");
    expect(updated.document.documentId).toBe(imported.document.documentId);
    expect(updated.document.activeRevisionId).not.toBe(originalRevisionId);
    expect(database.connection.prepare(`
      SELECT id, status FROM document_revisions WHERE document_id = ? ORDER BY created_at, id
    `).all(imported.document.documentId)).toEqual([
      { id: originalRevisionId, status: "ready" },
      { id: updated.document.activeRevisionId, status: "ready" },
    ]);
    expect(database.connection.prepare(`
      SELECT text FROM semantic_blocks WHERE revision_id = ? ORDER BY block_order
    `).all(originalRevisionId)).toEqual([
      { text: "Original" },
      { text: "First version." },
    ]);
  });

  it("更新来源无效时保留当前 Revision 和可读文档", async () => {
    const { database, library } = await createFixture();
    const imported = await library.importDocument("stable.md", Readable.from("# Stable"));

    await expect(library.updateDocument(
      imported.document.documentId,
      "stable.md",
      Readable.from(Buffer.from([0xc3, 0x28])),
    )).rejects.toMatchObject({ code: "DOCUMENT_SOURCE_INVALID" });

    expect(library.getDocument(imported.document.documentId).activeRevisionId)
      .toBe(imported.document.activeRevisionId);
    expect(database.connection.prepare(`
      SELECT COUNT(*) AS count FROM document_revisions WHERE document_id = ?
    `).get(imported.document.documentId)).toEqual({ count: 1 });
    expect(database.connection.prepare(`
      SELECT import_kind, status, document_id FROM import_operations
      WHERE import_kind = 'revision_update'
    `).get()).toEqual({
      import_kind: "revision_update",
      status: "failed",
      document_id: imported.document.documentId,
    });
  });

  it("启动时完成已进入 committing 且仍有 staging 文件的导入", async () => {
    const { database, fileStore, library, repository } = await createFixture();
    const operationId = "operation-recoverable";
    const documentId = "document-recoverable";
    const revisionId = "revision-recoverable";
    const resourceId = "resource-recoverable";
    const stagingKey = fileStore.stagingKey(operationId);
    const storageKey = fileStore.sourceStorageKey(documentId, resourceId, ".md");
    const timestamp = "2026-09-07T00:00:00.000Z";

    repository.createImportOperation({
      operationId,
      kind: "new_document",
      originalFilename: "recover.md",
      stagingKey,
      documentId: null,
      now: timestamp,
    });
    const stored = await fileStore.writeStagingFile(stagingKey, Readable.from("# Recover"));
    const artifact = await new MarkdownDocumentAdapter().import({
      probe: { originalFilename: "recover.md", mediaType: "text/markdown" },
      content: new TextEncoder().encode("# Recover"),
    }, revisionId);
    database.transaction(() => {
      repository.registerDraftDocument({
        operationId,
        documentId,
        revisionId,
        resourceId,
        title: "recover",
        sceneId: "english_reading",
        originalFilename: "recover.md",
        storageKey,
        contentHash: stored.contentHash,
        byteSize: stored.byteSize,
        sourceMediaType: "text/markdown",
        artifact,
        managedImages: [],
        now: timestamp,
      });
    });

    await library.recoverInterruptedImports();

    expect(library.getImportOperation(operationId).status).toBe("completed");
    expect(library.getDocument(documentId).status).toBe("ready");
    await expect(fileStore.exists(storageKey)).resolves.toBe(true);
    await expect(fileStore.exists(stagingKey)).resolves.toBe(false);
  });

  it("启动时将尚未提交的接收任务标记为 interrupted 并清理 staging", async () => {
    const { fileStore, library, repository } = await createFixture();
    const operationId = "operation-interrupted";
    const stagingKey = fileStore.stagingKey(operationId);

    repository.createImportOperation({
      operationId,
      kind: "new_document",
      originalFilename: "interrupted.md",
      stagingKey,
      documentId: null,
      now: "2026-09-07T00:00:00.000Z",
    });
    repository.updateImportStatus(operationId, "receiving", "2026-09-07T00:00:01.000Z");
    await fileStore.writeStagingFile(stagingKey, Readable.from("# Interrupted"));

    await library.recoverInterruptedImports();

    expect(library.getImportOperation(operationId)).toMatchObject({
      status: "interrupted",
      errorCode: "OPERATION_INTERRUPTED",
    });
    await expect(fileStore.exists(stagingKey)).resolves.toBe(false);
    expect(library.listDocuments()).toEqual([]);
  });

  it("启动时中断的 Revision 更新不会删除既有文档", async () => {
    const { fileStore, library, repository } = await createFixture();
    const imported = await library.importDocument("stable.md", Readable.from("# Stable"));
    const operationId = "operation-update-interrupted";
    const stagingKey = fileStore.stagingKey(operationId);
    repository.createImportOperation({
      operationId,
      kind: "revision_update",
      originalFilename: "stable.md",
      stagingKey,
      documentId: imported.document.documentId,
      now: "2026-09-08T00:00:00.000Z",
    });
    repository.updateImportStatus(operationId, "receiving", "2026-09-08T00:00:01.000Z");
    await fileStore.writeStagingFile(stagingKey, Readable.from("# Interrupted Update"));

    await library.recoverInterruptedImports();

    expect(library.getImportOperation(operationId)).toMatchObject({
      kind: "revision_update",
      status: "interrupted",
      documentId: imported.document.documentId,
    });
    expect(library.getDocument(imported.document.documentId).activeRevisionId)
      .toBe(imported.document.activeRevisionId);
  });
});
