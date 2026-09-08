import type {
  ReaderDocument,
  ReadingProgress,
  UpdateReadingProgressRequest,
} from "@lumen/api-contract";

import { ApplicationError } from "./errors.js";
import type { ReaderApplicationDependencies } from "./ports.js";

export class ReaderApplication {
  constructor(private readonly dependencies: ReaderApplicationDependencies) {}

  async openDocument(documentId: string, requestedRevisionId?: string): Promise<ReaderDocument> {
    const document = this.dependencies.documents.getDocument(documentId);
    if (document === null) {
      throw new ApplicationError({
        code: "DOCUMENT_NOT_FOUND",
        message: "未找到指定文档",
        statusCode: 404,
      });
    }

    const revisionId = requestedRevisionId ?? document.activeRevisionId;
    if (!this.dependencies.reader.revisionBelongsToDocument(documentId, revisionId)) {
      throw new ApplicationError({
        code: "DOCUMENT_REVISION_NOT_FOUND",
        message: "未找到该文档的指定历史版本",
        statusCode: 404,
      });
    }

    let projection = this.dependencies.reader.getProjection(revisionId);
    if (projection === null) {
      throw new ApplicationError({
        code: "DOCUMENT_PROJECTION_UNAVAILABLE",
        message: "文档阅读投影不可用，请重新导入文档",
        statusCode: 409,
      });
    }

    const adapter = this.dependencies.adapters.get(projection.format.formatId);
    if (adapter === null) {
      throw new ApplicationError({
        code: "DOCUMENT_PROJECTION_UNAVAILABLE",
        message: "当前服务没有可读取该文档格式的 Adapter",
        statusCode: 409,
      });
    }
    const currentDescriptor = adapter.descriptor;
    if (
      projection.format.semanticProjectionVersion !== currentDescriptor.semanticProjectionVersion
      || projection.format.sourceMappingVersion !== currentDescriptor.sourceMappingVersion
    ) {
      throw new ApplicationError({
        code: "DOCUMENT_REVISION_UPDATE_REQUIRED",
        message: "文档语义投影版本已变化，请创建新 Revision",
        statusCode: 409,
      });
    }

    const blocks = this.dependencies.reader.listBlocks(revisionId);
    const outline = this.dependencies.reader.listOutline(revisionId);
    if (
      projection.format.adapterVersion !== currentDescriptor.adapterVersion
      || projection.format.renderProjectionVersion !== currentDescriptor.renderProjectionVersion
    ) {
      const source = this.dependencies.reader.getRevisionSource(revisionId);
      if (source === null) {
        throw new ApplicationError({
          code: "DOCUMENT_PROJECTION_UNAVAILABLE",
          message: "文档来源资源不可用，无法重建阅读投影",
          statusCode: 409,
        });
      }
      const artifact = await adapter.import({
        probe: { originalFilename: source.originalFilename, mediaType: source.mediaType },
        content: await this.dependencies.fileStore.readSource(source.storageKey),
      }, revisionId);
      adapter.validateArtifact(artifact);
      if (
        JSON.stringify(artifact.blocks) !== JSON.stringify(blocks)
        || JSON.stringify(artifact.outline) !== JSON.stringify(outline)
      ) {
        throw new ApplicationError({
          code: "DOCUMENT_REVISION_UPDATE_REQUIRED",
          message: "投影重建会改变稳定语义内容，请创建新 Revision",
          statusCode: 409,
        });
      }
      this.dependencies.transaction.run(() => {
        this.dependencies.reader.replaceRenderProjection({
          revisionId,
          adapterVersion: currentDescriptor.adapterVersion,
          renderProjectionVersion: currentDescriptor.renderProjectionVersion,
          renderHtml: artifact.renderHtml,
          now: this.dependencies.clock.now(),
        });
      });
      projection = this.dependencies.reader.getProjection(revisionId);
      if (projection === null) {
        throw new ApplicationError({
          code: "DOCUMENT_PROJECTION_UNAVAILABLE",
          message: "重建后的文档阅读投影不可用",
          statusCode: 409,
        });
      }
    }

    return {
      document,
      revision: {
        revisionId: projection.revisionId,
        format: projection.format,
        capabilities: projection.capabilities,
      },
      renderHtml: projection.renderHtml,
      blocks,
      outline,
      progress: revisionId === document.activeRevisionId
        ? this.dependencies.reader.getProgress(documentId)
        : null,
    };
  }

  updateProgress(
    documentId: string,
    input: UpdateReadingProgressRequest,
  ): ReadingProgress {
    if (!this.dependencies.reader.isValidPosition(documentId, input)) {
      throw new ApplicationError({
        code: "READING_POSITION_INVALID",
        message: "阅读位置不属于当前文档版本",
        statusCode: 409,
      });
    }

    return this.dependencies.transaction.run(() =>
      this.dependencies.reader.saveProgress(documentId, input, this.dependencies.clock.now()),
    );
  }
}
