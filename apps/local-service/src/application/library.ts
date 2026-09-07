import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import type { Readable } from "node:stream";

import type {
  DocumentDetail,
  DocumentSummary,
  ImportDocumentResponse,
  ImportOperation,
} from "@lumen/api-contract";

import { LibraryRepository } from "../content/library-repository.js";
import { MarkdownDocumentAdapter } from "../content/markdown/markdown-adapter.js";
import type { LumenDatabase } from "../infrastructure/database/database.js";
import { isMarkdownFilename, ManagedFileStore } from "../infrastructure/files/managed-file-store.js";
import { ApplicationError } from "./errors.js";

function now(): string {
  return new Date().toISOString();
}

function titleFromFilename(filename: string): string {
  const title = basename(filename, extname(filename)).trim();
  return title.length === 0 ? "未命名文档" : title;
}

export class LibraryApplication {
  private readonly repository: LibraryRepository;
  private readonly markdownAdapter = new MarkdownDocumentAdapter();

  constructor(
    private readonly database: LumenDatabase,
    private readonly fileStore: ManagedFileStore,
  ) {
    this.repository = new LibraryRepository(database.connection);
  }

  listDocuments(): DocumentSummary[] {
    return this.repository.listDocuments();
  }

  getDocument(documentId: string): DocumentDetail {
    const document = this.repository.getDocument(documentId);
    if (document === null) {
      throw new ApplicationError({
        code: "DOCUMENT_NOT_FOUND",
        message: "未找到指定文档",
        statusCode: 404,
      });
    }
    return document;
  }

  getImportOperation(operationId: string): ImportOperation {
    const operation = this.repository.getImportOperation(operationId);
    if (operation === null) {
      throw new ApplicationError({
        code: "IMPORT_OPERATION_NOT_FOUND",
        message: "未找到指定导入任务",
        statusCode: 404,
      });
    }
    return operation;
  }

  async importMarkdown(originalFilename: string, source: Readable): Promise<ImportDocumentResponse> {
    const safeFilename = basename(originalFilename);
    if (safeFilename !== originalFilename || !isMarkdownFilename(safeFilename)) {
      throw new ApplicationError({
        code: "DOCUMENT_FORMAT_UNSUPPORTED",
        message: "一期 MVP 只支持导入 .md 文件",
        statusCode: 415,
      });
    }

    const operationId = randomUUID();
    const documentId = randomUUID();
    const revisionId = randomUUID();
    const resourceId = randomUUID();
    const stagingKey = this.fileStore.stagingKey(operationId);
    const storageKey = this.fileStore.sourceStorageKey(documentId, resourceId);
    let draftRegistered = false;

    this.repository.createImportOperation({
      operationId,
      originalFilename: safeFilename,
      stagingKey,
      now: now(),
    });

    try {
      this.repository.updateImportStatus(operationId, "receiving", now());
      const storedFile = await this.fileStore.writeStagingFile(stagingKey, source);

      this.repository.updateImportStatus(operationId, "inspecting", now());
      const markdown = await this.fileStore.validateMarkdown(stagingKey);
      const artifact = await this.markdownAdapter.import(markdown, revisionId);

      this.database.transaction(() => {
        this.repository.registerDraftDocument({
          documentId,
          revisionId,
          resourceId,
          operationId,
          title: titleFromFilename(safeFilename),
          originalFilename: safeFilename,
          storageKey,
          contentHash: storedFile.contentHash,
          byteSize: storedFile.byteSize,
          artifact,
          now: now(),
        });
      });
      draftRegistered = true;

      await this.fileStore.promote(stagingKey, storageKey);

      this.database.transaction(() => {
        this.repository.completeImport({ operationId, documentId, revisionId, resourceId, now: now() });
      });

      return {
        operation: this.getImportOperation(operationId),
        document: this.getDocument(documentId),
      };
    } catch (error) {
      await this.fileStore.remove(stagingKey);
      await this.fileStore.remove(storageKey);

      const applicationError =
        error instanceof ApplicationError
          ? new ApplicationError({
              code: error.code,
              message: error.message,
              retryable: error.retryable,
              operationId,
              statusCode: error.statusCode,
              cause: error,
            })
          : new ApplicationError({
              code: "IMPORT_FAILED",
              message: "文档导入失败",
              retryable: true,
              operationId,
              statusCode: 500,
              cause: error,
            });

      this.database.transaction(() => {
        if (draftRegistered) {
          this.repository.deleteDraftDocument(documentId);
        }
        this.repository.failImport({
          operationId,
          errorCode: applicationError.code,
          errorMessage: applicationError.message,
          now: now(),
        });
      });
      throw applicationError;
    }
  }

  async recoverInterruptedImports(): Promise<void> {
    for (const operation of this.repository.listRecoverableImports()) {
      if (
        operation.status === "committing" &&
        operation.documentId !== null &&
        operation.revisionId !== null &&
        operation.resourceId !== null &&
        operation.storageKey !== null
      ) {
        const finalExists = await this.fileStore.exists(operation.storageKey);
        const stagingExists =
          operation.stagingKey !== null && (await this.fileStore.exists(operation.stagingKey));

        if (!finalExists && stagingExists && operation.stagingKey !== null) {
          await this.fileStore.promote(operation.stagingKey, operation.storageKey);
        }

        if (finalExists || stagingExists) {
          this.database.transaction(() => {
            this.repository.completeImport({
              operationId: operation.operationId,
              documentId: operation.documentId!,
              revisionId: operation.revisionId!,
              resourceId: operation.resourceId!,
              now: now(),
            });
          });
          continue;
        }
      }

      this.database.transaction(() => {
        if (operation.documentId !== null) {
          this.repository.deleteDraftDocument(operation.documentId);
        }
        this.repository.failImport({
          operationId: operation.operationId,
          errorCode: "OPERATION_INTERRUPTED",
          errorMessage: "Local Service 重启前导入任务未完成",
          status: "interrupted",
          now: now(),
        });
      });
      await this.fileStore.remove(operation.stagingKey);
    }

    await this.fileStore.cleanupStaging();
  }
}
