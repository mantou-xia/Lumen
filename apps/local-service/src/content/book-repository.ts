import type {
  BookDetail,
  BookReadingProgress,
  BookSummary,
  DocumentSummary,
  ReadingProgress,
  UpdateReadingProgressRequest,
} from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

import type { BookPageRecord, BookRepositoryPort } from "../application/ports.js";

interface BookSummaryRow {
  book_id: string;
  title: string;
  format_id: string;
  status: "ready" | "archived";
  page_count: number;
  unread_auto_page_count: number;
  has_daily_reading_automation: number;
  created_at: string;
  updated_at: string;
}

interface BookPageRow extends BookSummaryRow {
  page_id: string;
  page_order: number;
  origin: "manual" | "folder_import" | "scheduled_reading";
  viewed_at: string | null;
  content_weight: number;
  document_id: string;
  active_revision_id: string;
  document_format_id: string;
  document_title: string;
  original_filename: string;
  byte_size: number;
  document_status: "ready" | "archived" | "unavailable";
  document_created_at: string;
  document_updated_at: string;
}

interface ProgressRow {
  document_id: string;
  revision_id: string;
  block_id: string;
  semantic_offset: number;
  page_progression: number;
  saved_at: string;
}

function mapSummary(row: BookSummaryRow): BookSummary {
  return {
    bookId: row.book_id,
    title: row.title,
    formatId: row.format_id,
    status: row.status,
    pageCount: row.page_count,
    unreadAutoPageCount: row.unread_auto_page_count,
    hasDailyReadingAutomation: row.has_daily_reading_automation === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDocument(row: BookPageRow): DocumentSummary {
  return {
    documentId: row.document_id,
    activeRevisionId: row.active_revision_id,
    formatId: row.document_format_id,
    title: row.document_title,
    originalFilename: row.original_filename,
    byteSize: row.byte_size,
    status: row.document_status,
    createdAt: row.document_created_at,
    updatedAt: row.document_updated_at,
  };
}

const summarySelect = `
  SELECT
    b.id AS book_id,
    b.title,
    b.format_id,
    b.status,
    COUNT(bp.id) AS page_count,
    SUM(CASE WHEN bp.origin = 'scheduled_reading' AND bp.viewed_at IS NULL THEN 1 ELSE 0 END)
      AS unread_auto_page_count,
    CASE WHEN EXISTS (
      SELECT 1 FROM daily_reading_automations automation WHERE automation.book_id = b.id
    ) THEN 1 ELSE 0 END AS has_daily_reading_automation,
    b.created_at,
    b.updated_at
  FROM books b
  LEFT JOIN book_pages bp ON bp.book_id = b.id
`;

export class BookRepository implements BookRepositoryPort {
  constructor(private readonly connection: DatabaseSync) {}

  listBooks(): BookSummary[] {
    const rows = this.connection.prepare(`
      ${summarySelect}
      WHERE b.status = 'ready'
      GROUP BY b.id
      ORDER BY b.updated_at DESC, b.id
    `).all() as unknown as BookSummaryRow[];
    return rows.map(mapSummary);
  }

  getBook(bookId: string): BookDetail | null {
    const summary = this.connection.prepare(`
      ${summarySelect}
      WHERE b.id = ?
      GROUP BY b.id
    `).get(bookId) as unknown as BookSummaryRow | undefined;
    if (summary === undefined) return null;
    const rows = this.connection.prepare(`
      SELECT
        bp.id AS page_id,
        bp.page_order,
        bp.origin,
        bp.viewed_at,
        MAX(1, (
          SELECT COALESCE(SUM(length(block.text)), 0)
          FROM semantic_blocks block
          WHERE block.revision_id = d.active_revision_id
        )) AS content_weight,
        d.id AS document_id,
        d.active_revision_id,
        d.format_id AS document_format_id,
        d.title AS document_title,
        resource.original_filename,
        resource.byte_size,
        d.status AS document_status,
        d.created_at AS document_created_at,
        d.updated_at AS document_updated_at
      FROM book_pages bp
      JOIN documents d ON d.id = bp.document_id
      JOIN document_revisions revision ON revision.id = d.active_revision_id
      JOIN document_resources resource ON resource.id = revision.source_resource_id
      WHERE bp.book_id = ?
      ORDER BY bp.page_order
    `).all(bookId) as unknown as BookPageRow[];
    return {
      ...mapSummary(summary),
      pages: rows.map((row) => ({
        pageId: row.page_id,
        order: row.page_order,
        contentWeight: row.content_weight,
        origin: row.origin,
        viewedAt: row.viewed_at,
        document: mapDocument(row),
      })),
    };
  }

  getPage(bookId: string, pageId: string): BookPageRecord | null {
    const row = this.connection.prepare(`
      SELECT id AS page_id, book_id, document_id, page_order, origin, viewed_at
      FROM book_pages
      WHERE book_id = ? AND id = ?
    `).get(bookId, pageId) as unknown as {
      page_id: string;
      book_id: string;
      document_id: string;
      page_order: number;
      origin: "manual" | "folder_import" | "scheduled_reading";
      viewed_at: string | null;
    } | undefined;
    return row === undefined ? null : {
      pageId: row.page_id,
      bookId: row.book_id,
      documentId: row.document_id,
      order: row.page_order,
      origin: row.origin,
      viewedAt: row.viewed_at,
    };
  }

  createBook(input: {
    bookId: string;
    title: string;
    formatId: string;
    pages: Array<{
      pageId: string;
      documentId: string;
      order: number;
      origin?: "manual" | "folder_import" | "scheduled_reading";
      viewedAt?: string | null;
      dailyReadingRunId?: string | null;
    }>;
    now: string;
  }): BookDetail {
    this.connection.prepare(`
      INSERT INTO books (id, title, format_id, status, created_at, updated_at)
      VALUES (?, ?, ?, 'ready', ?, ?)
    `).run(input.bookId, input.title, input.formatId, input.now, input.now);
    const insertPage = this.connection.prepare(`
      INSERT INTO book_pages (
        id, book_id, document_id, page_order, origin, viewed_at, daily_reading_run_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const page of input.pages) {
      insertPage.run(
        page.pageId,
        input.bookId,
        page.documentId,
        page.order,
        page.origin ?? "manual",
        page.viewedAt ?? input.now,
        page.dailyReadingRunId ?? null,
        input.now,
      );
    }
    const book = this.getBook(input.bookId);
    if (book === null) throw new Error("创建 Book 后无法读取记录");
    return book;
  }

  appendPage(input: {
    pageId: string;
    bookId: string;
    documentId: string;
    origin: "manual" | "folder_import" | "scheduled_reading";
    viewedAt: string | null;
    dailyReadingRunId: string | null;
    now: string;
  }): BookDetail {
    this.connection.prepare(`
      INSERT INTO book_pages (
        id, book_id, document_id, page_order, origin, viewed_at, daily_reading_run_id, created_at
      ) VALUES (
        ?, ?, ?, (SELECT COUNT(*) FROM book_pages WHERE book_id = ?), ?, ?, ?, ?
      )
    `).run(
      input.pageId,
      input.bookId,
      input.documentId,
      input.bookId,
      input.origin,
      input.viewedAt,
      input.dailyReadingRunId,
      input.now,
    );
    this.connection.prepare("UPDATE books SET updated_at = ? WHERE id = ?")
      .run(input.now, input.bookId);
    const book = this.getBook(input.bookId);
    if (book === null) throw new Error("追加 Book Page 后无法读取记录");
    return book;
  }

  markPageViewed(bookId: string, pageId: string, viewedAt: string): void {
    this.connection.prepare(`
      UPDATE book_pages
      SET viewed_at = COALESCE(viewed_at, ?)
      WHERE book_id = ? AND id = ? AND origin = 'scheduled_reading'
    `).run(viewedAt, bookId, pageId);
  }

  reorderPages(bookId: string, pageIds: readonly string[], now: string): BookDetail {
    this.connection.prepare(`
      UPDATE book_pages
      SET page_order = page_order + ?
      WHERE book_id = ?
    `).run(pageIds.length, bookId);
    const updatePage = this.connection.prepare(`
      UPDATE book_pages SET page_order = ? WHERE book_id = ? AND id = ?
    `);
    pageIds.forEach((pageId, order) => updatePage.run(order, bookId, pageId));
    this.connection.prepare("UPDATE books SET updated_at = ? WHERE id = ?").run(now, bookId);
    const book = this.getBook(bookId);
    if (book === null) throw new Error("调整 Book Page 顺序后无法读取记录");
    return book;
  }

  getActivePageId(bookId: string): string | null {
    const row = this.connection.prepare(`
      SELECT active_page_id FROM book_reading_states WHERE book_id = ?
    `).get(bookId) as unknown as { active_page_id: string } | undefined;
    return row?.active_page_id ?? null;
  }

  getPageProgress(
    bookId: string,
    pageId: string,
    activeRevisionId: string,
  ): ReadingProgress | null {
    const row = this.connection.prepare(`
      SELECT
        bp.document_id,
        progress.revision_id,
        progress.block_id,
        progress.semantic_offset,
        progress.page_progression,
        progress.saved_at
      FROM book_page_progress progress
      JOIN book_pages bp ON bp.book_id = progress.book_id AND bp.id = progress.page_id
      WHERE progress.book_id = ? AND progress.page_id = ? AND progress.revision_id = ?
    `).get(bookId, pageId, activeRevisionId) as unknown as ProgressRow | undefined;
    return row === undefined ? null : {
      documentId: row.document_id,
      revisionId: row.revision_id,
      blockId: row.block_id,
      offset: row.semantic_offset,
      progression: row.page_progression,
      savedAt: row.saved_at,
    };
  }

  isValidPosition(
    bookId: string,
    pageId: string,
    input: UpdateReadingProgressRequest,
  ): boolean {
    return this.connection.prepare(`
      SELECT 1
      FROM book_pages bp
      JOIN documents d ON d.id = bp.document_id
      JOIN semantic_blocks sb ON sb.revision_id = d.active_revision_id
      WHERE bp.book_id = ? AND bp.id = ?
        AND d.active_revision_id = ? AND sb.id = ? AND ? <= length(sb.text)
    `).get(bookId, pageId, input.revisionId, input.blockId, input.offset) !== undefined;
  }

  calculateProgress(bookId: string, pageId: string, pageProgression: number): number {
    const rows = this.connection.prepare(`
      SELECT bp.id AS page_id, bp.page_order, COALESCE(SUM(length(sb.text)), 0) AS weight
      FROM book_pages bp
      JOIN documents d ON d.id = bp.document_id
      LEFT JOIN semantic_blocks sb ON sb.revision_id = d.active_revision_id
      WHERE bp.book_id = ?
      GROUP BY bp.id, bp.page_order
      ORDER BY bp.page_order
    `).all(bookId) as unknown as Array<{ page_id: string; page_order: number; weight: number }>;
    const totalWeight = rows.reduce((total, row) => total + Math.max(row.weight, 1), 0);
    if (totalWeight === 0) return 0;
    let completedWeight = 0;
    for (const row of rows) {
      const weight = Math.max(row.weight, 1);
      if (row.page_id === pageId) {
        return Math.min(1, Math.max(0, (completedWeight + weight * pageProgression) / totalWeight));
      }
      completedWeight += weight;
    }
    return 0;
  }

  saveProgress(
    bookId: string,
    pageId: string,
    input: UpdateReadingProgressRequest,
    savedAt: string,
  ): BookReadingProgress {
    this.connection.prepare(`
      INSERT INTO book_page_progress (
        book_id, page_id, revision_id, block_id, semantic_offset, page_progression, saved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id, page_id) DO UPDATE SET
        revision_id = excluded.revision_id,
        block_id = excluded.block_id,
        semantic_offset = excluded.semantic_offset,
        page_progression = excluded.page_progression,
        saved_at = excluded.saved_at
    `).run(
      bookId,
      pageId,
      input.revisionId,
      input.blockId,
      input.offset,
      input.progression,
      savedAt,
    );
    this.connection.prepare(`
      INSERT INTO book_reading_states (book_id, active_page_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(book_id) DO UPDATE SET
        active_page_id = excluded.active_page_id,
        updated_at = excluded.updated_at
    `).run(bookId, pageId, savedAt);
    const page = this.getPage(bookId, pageId);
    if (page === null) throw new Error("保存 Book 进度后无法读取 Page");
    return {
      bookId,
      pageId,
      documentId: page.documentId,
      revisionId: input.revisionId,
      blockId: input.blockId,
      offset: input.offset,
      pageProgression: input.progression,
      bookProgression: this.calculateProgress(bookId, pageId, input.progression),
      savedAt,
    };
  }
}
