import type {
  ReaderDocument,
  ReadingProgress,
  UpdateReadingProgressRequest,
} from "@lumen/api-contract";

import { LibraryRepository } from "../content/library-repository.js";
import { ReaderRepository } from "../content/reader-repository.js";
import type { LumenDatabase } from "../infrastructure/database/database.js";
import { ApplicationError } from "./errors.js";

export class ReaderApplication {
  private readonly libraryRepository: LibraryRepository;
  private readonly readerRepository: ReaderRepository;

  constructor(private readonly database: LumenDatabase) {
    this.libraryRepository = new LibraryRepository(database.connection);
    this.readerRepository = new ReaderRepository(database.connection);
  }

  openDocument(documentId: string): ReaderDocument {
    const document = this.libraryRepository.getDocument(documentId);
    if (document === null) {
      throw new ApplicationError({
        code: "DOCUMENT_NOT_FOUND",
        message: "未找到指定文档",
        statusCode: 404,
      });
    }

    const projection = this.readerRepository.getProjection(document.activeRevisionId);
    if (projection === null) {
      throw new ApplicationError({
        code: "DOCUMENT_PROJECTION_UNAVAILABLE",
        message: "文档阅读投影不可用，请重新导入文档",
        statusCode: 409,
      });
    }

    return {
      document,
      revision: {
        revisionId: projection.revision_id,
        adapterVersion: projection.adapter_version,
        semanticProjectionVersion: projection.semantic_projection_version,
        renderProjectionVersion: projection.render_projection_version,
        sourceMappingVersion: projection.source_mapping_version,
      },
      renderHtml: projection.render_html,
      blocks: this.readerRepository.listBlocks(document.activeRevisionId),
      outline: this.readerRepository.listOutline(document.activeRevisionId),
      progress: this.readerRepository.getProgress(documentId),
    };
  }

  updateProgress(
    documentId: string,
    input: UpdateReadingProgressRequest,
  ): ReadingProgress {
    if (!this.readerRepository.isValidPosition(documentId, input)) {
      throw new ApplicationError({
        code: "READING_POSITION_INVALID",
        message: "阅读位置不属于当前文档版本",
        statusCode: 409,
      });
    }

    return this.database.transaction(() =>
      this.readerRepository.saveProgress(documentId, input, new Date().toISOString()),
    );
  }
}
