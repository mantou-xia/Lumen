import { describe, expect, it } from "vitest";

import {
  bookReadingProgressSchema,
  createBookRequestSchema,
  reorderBookPagesRequestSchema,
} from "./book.js";

describe("Book contracts", () => {
  it("要求创建 Book 时至少包含一个 Document", () => {
    expect(createBookRequestSchema.safeParse({ title: "Reading", documentIds: [] }).success)
      .toBe(false);
  });

  it("要求重排时提交非空的完整 Page ID 列表", () => {
    expect(reorderBookPagesRequestSchema.safeParse({ pageIds: [] }).success).toBe(false);
  });

  it("区分 Page 内进度与 Book 聚合进度", () => {
    expect(bookReadingProgressSchema.parse({
      bookId: "book-1",
      pageId: "page-1",
      documentId: "document-1",
      revisionId: "revision-1",
      blockId: "block-1",
      offset: 2,
      pageProgression: 0.5,
      bookProgression: 0.25,
      savedAt: "2026-09-10T00:00:00.000Z",
    })).toMatchObject({ pageProgression: 0.5, bookProgression: 0.25 });
  });
});
