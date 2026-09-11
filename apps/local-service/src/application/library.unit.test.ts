import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type {
  DraftDocumentInput,
  LibraryRepositoryPort,
} from "./ports.js";
import { LibraryApplication } from "./library.js";
import { FormatAdapterRegistry } from "../content/format/format-adapter-registry.js";
import { MarkdownDocumentAdapter } from "../content/markdown/markdown-adapter.js";

describe("LibraryApplication Ports", () => {
  it("不依赖 HTTP、SQLite 或真实文件系统即可编排完整导入", async () => {
    let draft: DraftDocumentInput | null = null;
    let completed = false;
    const repository: LibraryRepositoryPort = {
      createImportOperation: vi.fn(),
      updateImportStatus: vi.fn(),
      registerDraftDocument: (input) => { draft = input; },
      registerDraftRevision: vi.fn(),
      completeImport: () => { completed = true; },
      failImport: vi.fn(),
      deleteDraftDocument: vi.fn(),
      deleteDraftRevision: vi.fn(),
      listDocuments: () => [],
      getDocument: (documentId) => completed && draft !== null ? {
        documentId,
        activeRevisionId: draft.revisionId,
        sourceResourceId: draft.resourceId,
        contentHash: draft.contentHash,
        formatId: "markdown",
        title: draft.title,
        originalFilename: draft.originalFilename,
        byteSize: draft.byteSize,
        status: "ready",
        createdAt: "2026-09-08T00:00:00.000Z",
        updatedAt: "2026-09-08T00:00:00.000Z",
      } : null,
      getImportOperation: (operationId) => completed ? {
        operationId,
        kind: "new_document",
        status: "completed",
        originalFilename: "chapter.md",
        documentId: "document-1",
        errorCode: null,
        errorMessage: null,
        createdAt: "2026-09-08T00:00:00.000Z",
        updatedAt: "2026-09-08T00:00:00.000Z",
        completedAt: "2026-09-08T00:00:00.000Z",
      } : null,
      listRecoverableImports: () => [],
      listDocumentStorageKeys: () => [],
    };
    const ids = ["operation-1", "document-1", "revision-1", "resource-1"];
    let transactionCalls = 0;
    const transaction = {
      run<T>(work: () => T): T {
        transactionCalls += 1;
        return work();
      },
    };
    const application = new LibraryApplication({
      adapters: new FormatAdapterRegistry([new MarkdownDocumentAdapter()]),
      clock: { now: () => "2026-09-08T00:00:00.000Z" },
      fileStore: {
        stagingKey: (operationId) => `staging/${operationId}`,
        sourceStorageKey: (documentId, resourceId, extension) =>
          `documents/${documentId}/${resourceId}${extension}`,
        imageStorageKey: (documentId, revisionId, resourceId, extension) =>
          `documents/${documentId}/${revisionId}/${resourceId}${extension}`,
        writeStagingFile: async () => ({ byteSize: 4, contentHash: "hash-1" }),
        writeManagedFile: async () => ({ byteSize: 4, contentHash: "image-hash" }),
        readSource: async () => new TextEncoder().encode("Text"),
        createReadStream: () => Readable.from("Text"),
        promote: vi.fn(async () => undefined),
        exists: async () => false,
        remove: vi.fn(async () => undefined),
        cleanupStaging: vi.fn(async () => undefined),
      },
      ids: { generate: () => ids.shift() ?? "unexpected-id" },
      repository,
      transaction,
    });

    const result = await application.importDocument("chapter.md", Readable.from("Text"));

    expect(result.document).toMatchObject({
      documentId: "document-1",
      activeRevisionId: "revision-1",
      title: "chapter",
    });
    expect(draft).toMatchObject({
      operationId: "operation-1",
      resourceId: "resource-1",
      storageKey: "documents/document-1/resource-1.md",
      sourceMediaType: "text/markdown",
    });
    expect(transactionCalls).toBe(2);
  });
});
