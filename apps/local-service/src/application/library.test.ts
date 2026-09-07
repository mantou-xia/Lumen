import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { LibraryRepository } from "../content/library-repository.js";
import { MarkdownDocumentAdapter } from "../content/markdown/markdown-adapter.js";
import { openDatabase, type LumenDatabase } from "../infrastructure/database/database.js";
import { ManagedFileStore } from "../infrastructure/files/managed-file-store.js";
import { LibraryApplication } from "./library.js";

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
    library: new LibraryApplication(database, fileStore),
    repository: new LibraryRepository(database.connection),
  };
}

describe("LibraryApplication", () => {
  it("相同文件名的多次导入使用不同受管资源", async () => {
    const { database, library } = await createFixture();

    const first = await library.importMarkdown("chapter.md", Readable.from("# First"));
    const second = await library.importMarkdown("chapter.md", Readable.from("# Second"));
    const resourceRows = database.connection
      .prepare("SELECT storage_key FROM document_resources ORDER BY created_at, id")
      .all() as Array<{ storage_key: string }>;

    expect(library.listDocuments()).toHaveLength(2);
    expect(first.document.documentId).not.toBe(second.document.documentId);
    expect(resourceRows).toHaveLength(2);
    expect(resourceRows[0]?.storage_key).not.toBe(resourceRows[1]?.storage_key);
    expect(resourceRows.every((row) => !row.storage_key.includes("chapter.md"))).toBe(true);
  });

  it("启动时完成已进入 committing 且仍有 staging 文件的导入", async () => {
    const { database, fileStore, library, repository } = await createFixture();
    const operationId = "operation-recoverable";
    const documentId = "document-recoverable";
    const revisionId = "revision-recoverable";
    const resourceId = "resource-recoverable";
    const stagingKey = fileStore.stagingKey(operationId);
    const storageKey = fileStore.sourceStorageKey(documentId, resourceId);
    const timestamp = "2026-09-07T00:00:00.000Z";

    repository.createImportOperation({
      operationId,
      originalFilename: "recover.md",
      stagingKey,
      now: timestamp,
    });
    const stored = await fileStore.writeStagingFile(stagingKey, Readable.from("# Recover"));
    const artifact = await new MarkdownDocumentAdapter().import("# Recover", revisionId);
    database.transaction(() => {
      repository.registerDraftDocument({
        operationId,
        documentId,
        revisionId,
        resourceId,
        title: "recover",
        originalFilename: "recover.md",
        storageKey,
        contentHash: stored.contentHash,
        byteSize: stored.byteSize,
        artifact,
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
      originalFilename: "interrupted.md",
      stagingKey,
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
});
