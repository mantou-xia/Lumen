import { describe, expect, it, vi } from "vitest";

import { createBook, openReaderBook, reorderBookPages } from "./book";

const summary = {
  bookId: "book-1",
  title: "Reading Book",
  formatId: "markdown",
  status: "ready",
  pageCount: 1,
  unreadAutoPageCount: 0,
  hasDailyReadingAutomation: false,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
} as const;

const document = {
  documentId: "document-1",
  activeRevisionId: "revision-1",
  formatId: "markdown",
  title: "Page One",
  originalFilename: "page-one.md",
  byteSize: 20,
  status: "ready",
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
} as const;

const detail = {
  ...summary,
  pages: [{
    pageId: "page-1",
    order: 0,
    contentWeight: 20,
    origin: "manual",
    viewedAt: "2026-09-10T00:00:00.000Z",
    document,
  }],
};

describe("book API", () => {
  it("创建 Book 时按用户顺序提交 Document ID", async () => {
    const fetcher = vi.fn(async () => Response.json(detail, { status: 201 }));
    await createBook({ title: "Reading Book", documentIds: ["document-1"] }, fetcher);
    expect(fetcher).toHaveBeenCalledWith("/api/books", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ title: "Reading Book", documentIds: ["document-1"] }),
    }));
  });

  it("通过 Page ID 打开 Book Reader", async () => {
    const fetcher = vi.fn(async () => Response.json({
      book: detail,
      activePageId: "page-1",
      document: {
        document,
        revision: {
          revisionId: "revision-1",
          format: {
            formatId: "markdown",
            adapterVersion: "markdown.adapter.v1",
            semanticProjectionVersion: "markdown.semantic.v1",
            renderProjectionVersion: "markdown.render.v1",
            sourceMappingVersion: "markdown.source-map.v1",
            supportedCapabilities: {
              selectableText: true,
              stableSourceLocation: true,
              nativeOutline: true,
              pagination: false,
              reflow: true,
              originalLayout: false,
              embeddedResources: false,
              search: true,
              annotations: true,
            },
          },
          capabilities: {
            selectableText: true,
            stableSourceLocation: true,
            nativeOutline: true,
            pagination: false,
            reflow: true,
            originalLayout: false,
            embeddedResources: false,
            search: true,
            annotations: true,
          },
        },
        renderHtml: "<p>Page</p>",
        blocks: [],
        outline: [],
        progress: null,
      },
      bookProgression: 0,
    }));
    await openReaderBook("book-1", "page-1", fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/reader/books/book-1?pageId=page-1",
      { headers: { accept: "application/json" } },
    );
  });

  it("重排时提交完整 Page ID 顺序", async () => {
    const fetcher = vi.fn(async () => Response.json(detail));
    await reorderBookPages("book-1", { pageIds: ["page-1"] }, fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/books/book-1/pages/order",
      expect.objectContaining({ body: JSON.stringify({ pageIds: ["page-1"] }) }),
    );
  });
});
