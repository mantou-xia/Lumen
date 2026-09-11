import { basename, extname } from "node:path";
import type { Readable } from "node:stream";

import type {
  DocumentDetail,
  DocumentSummary,
  ImportDocumentResponse,
  ImportOperation,
  ImportOperationKind,
} from "@lumen/api-contract";

import { ApplicationError } from "./errors.js";
import type { LibraryApplicationDependencies, ManagedImageDraft } from "./ports.js";
import {
  DocumentSourceError,
  type DocumentAdapter,
  type DocumentSourceProbe,
} from "../content/format/format-contract.js";
import { imageExtension } from "../content/image-media.js";

function titleFromFilename(filename: string): string {
  const title = basename(filename, extname(filename)).trim();
  return title.length === 0 ? "未命名文档" : title;
}

export class LibraryApplication {
  constructor(private readonly dependencies: LibraryApplicationDependencies) {}

  listDocuments(): DocumentSummary[] {
    return this.dependencies.repository.listDocuments();
  }

  getDocument(documentId: string): DocumentDetail {
    const document = this.dependencies.repository.getDocument(documentId);
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
    const operation = this.dependencies.repository.getImportOperation(operationId);
    if (operation === null) {
      throw new ApplicationError({
        code: "IMPORT_OPERATION_NOT_FOUND",
        message: "未找到指定导入任务",
        statusCode: 404,
      });
    }
    return operation;
  }

  async importDocument(
    originalFilename: string,
    source: Readable,
    mediaType: string | null = null,
    container?: { sourcePath: string; files: ReadonlyMap<string, Uint8Array> },
  ): Promise<ImportDocumentResponse> {
    const resolved = this.resolveAdapter(originalFilename, mediaType);
    const operationId = this.dependencies.ids.generate();
    const documentId = this.dependencies.ids.generate();
    return this.runImport({
      kind: "new_document",
      operationId,
      documentId,
      source,
      ...(container === undefined ? {} : { container }),
      ...resolved,
    });
  }

  async updateDocument(
    documentId: string,
    originalFilename: string,
    source: Readable,
    mediaType: string | null = null,
  ): Promise<ImportDocumentResponse> {
    const document = this.getDocument(documentId);
    const resolved = this.resolveAdapter(originalFilename, mediaType);
    if (resolved.adapter.descriptor.formatId !== document.formatId) {
      throw new ApplicationError({
        code: "DOCUMENT_FORMAT_UNSUPPORTED",
        message: "更新来源必须与原文档格式一致",
        statusCode: 415,
      });
    }
    return this.runImport({
      kind: "revision_update",
      operationId: this.dependencies.ids.generate(),
      documentId,
      source,
      ...resolved,
    });
  }

  private resolveAdapter(originalFilename: string, mediaType: string | null): {
    safeFilename: string;
    probe: DocumentSourceProbe;
    adapter: DocumentAdapter;
  } {
    const safeFilename = basename(originalFilename);
    if (safeFilename !== originalFilename) {
      throw new ApplicationError({
        code: "DOCUMENT_SOURCE_INVALID",
        message: "文件名不能包含目录路径",
        statusCode: 400,
      });
    }

    const probe = { originalFilename: safeFilename, mediaType };
    const adapter = this.dependencies.adapters.resolve(probe);
    if (adapter === null) {
      throw new ApplicationError({
        code: "DOCUMENT_FORMAT_UNSUPPORTED",
        message: "当前不支持该文档格式",
        statusCode: 415,
      });
    }
    return { safeFilename, probe, adapter };
  }

  private async runImport(input: {
    kind: ImportOperationKind;
    operationId: string;
    documentId: string;
    safeFilename: string;
    probe: DocumentSourceProbe;
    adapter: DocumentAdapter;
    source: Readable;
    container?: { sourcePath: string; files: ReadonlyMap<string, Uint8Array> };
  }): Promise<ImportDocumentResponse> {
    const { adapter, documentId, operationId, probe, safeFilename } = input;
    const revisionId = this.dependencies.ids.generate();
    const resourceId = this.dependencies.ids.generate();
    const stagingKey = this.dependencies.fileStore.stagingKey(operationId);
    const storageKey = this.dependencies.fileStore.sourceStorageKey(
      documentId,
      resourceId,
      adapter.sourceFileExtension,
    );
    let draftRegistered = false;
    const managedImageStorageKeys: string[] = [];

    this.dependencies.repository.createImportOperation({
      operationId,
      kind: input.kind,
      originalFilename: safeFilename,
      stagingKey,
      documentId: input.kind === "revision_update" ? documentId : null,
      now: this.dependencies.clock.now(),
    });

    try {
      this.dependencies.repository.updateImportStatus(
        operationId,
        "receiving",
        this.dependencies.clock.now(),
      );
      const storedFile = await this.dependencies.fileStore.writeStagingFile(stagingKey, input.source);

      this.dependencies.repository.updateImportStatus(
        operationId,
        "inspecting",
        this.dependencies.clock.now(),
      );
      const documentSource = {
        probe,
        content: await this.dependencies.fileStore.readSource(stagingKey),
        ...(input.container === undefined ? {} : { container: input.container }),
      };
      const inspection = await adapter.inspect(documentSource);
      const artifact = await adapter.import(documentSource, revisionId);
      adapter.validateArtifact(artifact);
      const managedImages: ManagedImageDraft[] = [];
      for (const image of artifact.resources) {
        const imageResourceId = this.dependencies.ids.generate();
        artifact.renderHtml = artifact.renderHtml
          .replaceAll(`__LUMEN_IMAGE_${image.resourceKey}__`, imageResourceId)
          .replaceAll(`data-missing-image-key="${image.resourceKey}"`, `data-missing-image-id="${imageResourceId}"`);
        if (image.content === null) {
          managedImages.push({
            resourceId: imageResourceId,
            sourceUrl: image.sourceUrl,
            altText: image.altText,
            originalFilename: image.originalFilename,
            mediaType: image.mediaType,
            storageKey: this.dependencies.fileStore.imageStorageKey(
              documentId,
              revisionId,
              imageResourceId,
              ".missing",
            ),
            contentHash: null,
            byteSize: 0,
            state: "missing" as const,
          });
          continue;
        }
        const imageStorageKey = this.dependencies.fileStore.imageStorageKey(
          documentId,
          revisionId,
          imageResourceId,
          imageExtension(image.mediaType),
        );
        const storedImage = await this.dependencies.fileStore.writeManagedFile(
          imageStorageKey,
          image.content,
        );
        managedImageStorageKeys.push(imageStorageKey);
        managedImages.push({
          resourceId: imageResourceId,
          sourceUrl: image.sourceUrl,
          altText: image.altText,
          originalFilename: image.originalFilename,
          mediaType: image.mediaType,
          storageKey: imageStorageKey,
          contentHash: storedImage.contentHash,
          byteSize: storedImage.byteSize,
          state: "staging" as const,
        });
      }

      this.dependencies.transaction.run(() => {
        const draft = {
          documentId,
          revisionId,
          resourceId,
          operationId,
          originalFilename: safeFilename,
          storageKey,
          contentHash: storedFile.contentHash,
          byteSize: storedFile.byteSize,
          sourceMediaType: adapter.sourceMediaType,
          artifact,
          managedImages,
          now: this.dependencies.clock.now(),
        };
        if (input.kind === "new_document") {
          this.dependencies.repository.registerDraftDocument({
            ...draft,
            title: inspection.suggestedTitle ?? titleFromFilename(safeFilename),
          });
        } else {
          this.dependencies.repository.registerDraftRevision(draft);
        }
      });
      draftRegistered = true;

      await this.dependencies.fileStore.promote(stagingKey, storageKey);

      this.dependencies.transaction.run(() => {
        this.dependencies.repository.completeImport({
          operationId,
          documentId,
          revisionId,
          resourceId,
          now: this.dependencies.clock.now(),
        });
      });

      return {
        operation: this.getImportOperation(operationId),
        document: this.getDocument(documentId),
      };
    } catch (error) {
      await this.dependencies.fileStore.remove(stagingKey);
      await this.dependencies.fileStore.remove(storageKey);
      await Promise.all(managedImageStorageKeys.map((key) => this.dependencies.fileStore.remove(key)));

      const applicationError =
        error instanceof DocumentSourceError
          ? new ApplicationError({
              code: "DOCUMENT_SOURCE_INVALID",
              message: error.message,
              operationId,
              statusCode: 400,
              cause: error,
            })
        : error instanceof ApplicationError
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

      this.dependencies.transaction.run(() => {
        if (draftRegistered) {
          if (input.kind === "new_document") {
            this.dependencies.repository.deleteDraftDocument(documentId);
          } else {
            this.dependencies.repository.deleteDraftRevision(revisionId);
          }
        }
        this.dependencies.repository.failImport({
          operationId,
          errorCode: applicationError.code,
          errorMessage: applicationError.message,
          now: this.dependencies.clock.now(),
        });
      });
      throw applicationError;
    }
  }

  async recoverInterruptedImports(): Promise<void> {
    for (const operation of this.dependencies.repository.listRecoverableImports()) {
      if (
        operation.status === "committing" &&
        operation.documentId !== null &&
        operation.revisionId !== null &&
        operation.resourceId !== null &&
        operation.storageKey !== null
      ) {
        const finalExists = await this.dependencies.fileStore.exists(operation.storageKey);
        const stagingExists =
          operation.stagingKey !== null
          && (await this.dependencies.fileStore.exists(operation.stagingKey));

        if (!finalExists && stagingExists && operation.stagingKey !== null) {
          await this.dependencies.fileStore.promote(operation.stagingKey, operation.storageKey);
        }

        if (finalExists || stagingExists) {
          this.dependencies.transaction.run(() => {
            this.dependencies.repository.completeImport({
              operationId: operation.operationId,
              documentId: operation.documentId!,
              revisionId: operation.revisionId!,
              resourceId: operation.resourceId!,
              now: this.dependencies.clock.now(),
            });
          });
          continue;
        }
      }

      this.dependencies.transaction.run(() => {
        if (operation.kind === "new_document" && operation.documentId !== null) {
          this.dependencies.repository.deleteDraftDocument(operation.documentId);
        } else if (operation.kind === "revision_update" && operation.revisionId !== null) {
          this.dependencies.repository.deleteDraftRevision(operation.revisionId);
        }
        this.dependencies.repository.failImport({
          operationId: operation.operationId,
          errorCode: "OPERATION_INTERRUPTED",
          errorMessage: "Local Service 重启前导入任务未完成",
          status: "interrupted",
          now: this.dependencies.clock.now(),
        });
      });
      await this.dependencies.fileStore.remove(operation.stagingKey);
    }

    await this.dependencies.fileStore.cleanupStaging();
  }
}
