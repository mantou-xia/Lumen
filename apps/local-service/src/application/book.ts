import type {
  BookDetail,
  BookReadingProgress,
  BookSummary,
  CreateBookRequest,
  ReaderBook,
  ReorderBookPagesRequest,
  UpdateBookReadingProgressRequest,
} from "@lumen/api-contract";

import { ApplicationError } from "./errors.js";
import type { BookApplicationDependencies } from "./ports.js";

export class BookApplication {
  constructor(private readonly dependencies: BookApplicationDependencies) {}

  listBooks(): BookSummary[] {
    return this.dependencies.repository.listBooks();
  }

  getBook(bookId: string): BookDetail {
    const book = this.dependencies.repository.getBook(bookId);
    if (book === null) {
      throw new ApplicationError({
        code: "BOOK_NOT_FOUND",
        message: "未找到指定 Book",
        statusCode: 404,
      });
    }
    return book;
  }

  createBook(input: CreateBookRequest): BookDetail {
    const uniqueDocumentIds = [...new Set(input.documentIds)];
    if (uniqueDocumentIds.length !== input.documentIds.length) {
      throw new ApplicationError({
        code: "BOOK_DOCUMENTS_INVALID",
        message: "同一份文档不能在一本 Book 中重复出现",
        statusCode: 400,
      });
    }
    const documents = uniqueDocumentIds.map((documentId) => {
      const document = this.dependencies.documents.getDocument(documentId);
      if (document === null || document.status !== "ready") {
        throw new ApplicationError({
          code: "BOOK_DOCUMENTS_INVALID",
          message: "Book 只能包含当前可阅读的文档",
          statusCode: 400,
        });
      }
      return document;
    });
    const formatId = documents[0]?.formatId;
    if (formatId !== "markdown" || documents.some((document) => document.formatId !== formatId)) {
      throw new ApplicationError({
        code: "BOOK_DOCUMENTS_INVALID",
        message: "当前只能使用同一格式的 Markdown 文档创建 Book",
        statusCode: 400,
      });
    }
    const bookId = this.dependencies.ids.generate();
    const now = this.dependencies.clock.now();
    return this.dependencies.transaction.run(() => this.dependencies.repository.createBook({
      bookId,
      title: input.title.trim(),
      formatId,
      pages: documents.map((document, order) => ({
        pageId: this.dependencies.ids.generate(),
        documentId: document.documentId,
        order,
      })),
      now,
    }));
  }

  reorderPages(bookId: string, input: ReorderBookPagesRequest): BookDetail {
    const book = this.getBook(bookId);
    const expectedIds = new Set(book.pages.map((page) => page.pageId));
    const actualIds = new Set(input.pageIds);
    if (
      actualIds.size !== input.pageIds.length
      || actualIds.size !== expectedIds.size
      || [...actualIds].some((pageId) => !expectedIds.has(pageId))
    ) {
      throw new ApplicationError({
        code: "BOOK_PAGE_ORDER_INVALID",
        message: "Page 排序必须包含当前 Book 的全部 Page，且不能重复",
        statusCode: 400,
      });
    }
    return this.dependencies.transaction.run(() =>
      this.dependencies.repository.reorderPages(
        bookId,
        input.pageIds,
        this.dependencies.clock.now(),
      ),
    );
  }

  async openBook(bookId: string, requestedPageId?: string): Promise<ReaderBook> {
    const book = this.getBook(bookId);
    const pageId = requestedPageId
      ?? this.dependencies.repository.getActivePageId(bookId)
      ?? book.pages[0]!.pageId;
    const page = book.pages.find((candidate) => candidate.pageId === pageId);
    if (page === undefined) {
      throw new ApplicationError({
        code: "BOOK_PAGE_NOT_FOUND",
        message: "未找到指定 Book Page",
        statusCode: 404,
      });
    }
    const document = await this.dependencies.reader.openDocument(page.document.documentId);
    const pageProgress = this.dependencies.repository.getPageProgress(
      bookId,
      pageId,
      document.revision.revisionId,
    );
    const progression = pageProgress?.progression ?? 0;
    return {
      book,
      activePageId: pageId,
      document: { ...document, progress: pageProgress },
      bookProgression: this.dependencies.repository.calculateProgress(
        bookId,
        pageId,
        progression,
      ),
    };
  }

  updateProgress(
    bookId: string,
    pageId: string,
    input: UpdateBookReadingProgressRequest,
  ): BookReadingProgress {
    if (!this.dependencies.repository.isValidPosition(bookId, pageId, input)) {
      throw new ApplicationError({
        code: "READING_POSITION_INVALID",
        message: "阅读位置不属于当前 Book Page 的活动文档版本",
        statusCode: 409,
      });
    }
    return this.dependencies.transaction.run(() => this.dependencies.repository.saveProgress(
      bookId,
      pageId,
      input,
      this.dependencies.clock.now(),
    ));
  }
}
