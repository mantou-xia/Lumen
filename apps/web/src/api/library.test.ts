import { describe, expect, it, vi } from "vitest";

import { getDocuments, importMarkdown, importMarkdownFolder } from "./library";

describe("library API", () => {
  it("解析文档列表响应", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        documents: [
          {
            documentId: "document-1",
            activeRevisionId: "revision-1",
            sceneId: "english_reading",
            formatId: "markdown",
            title: "A Room of One's Own",
            originalFilename: "room.md",
            byteSize: 128,
            status: "ready",
            createdAt: "2026-09-07T00:00:00.000Z",
            updatedAt: "2026-09-07T00:00:00.000Z",
          },
        ],
      }),
    );

    await expect(getDocuments(fetcher)).resolves.toHaveLength(1);
  });

  it("以原始字节流上传 Markdown", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          operation: {
            operationId: "operation-1",
            kind: "new_document",
            status: "completed",
            originalFilename: "阅读.md",
            documentId: "document-1",
            errorCode: null,
            errorMessage: null,
            createdAt: "2026-09-07T00:00:00.000Z",
            updatedAt: "2026-09-07T00:00:00.000Z",
            completedAt: "2026-09-07T00:00:00.000Z",
          },
          document: {
            documentId: "document-1",
            activeRevisionId: "revision-1",
            sceneId: "technical_learning",
            formatId: "markdown",
            title: "阅读",
            originalFilename: "阅读.md",
            byteSize: 7,
            status: "ready",
            createdAt: "2026-09-07T00:00:00.000Z",
            updatedAt: "2026-09-07T00:00:00.000Z",
          },
        },
        { status: 201 },
      ),
    );
    const file = new File(["# Read"], "阅读.md", { type: "text/markdown" });

    await importMarkdown(file, "technical_learning", fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/imports",
      expect.objectContaining({
        method: "POST",
        body: file,
        headers: expect.objectContaining({
          "x-lumen-filename": encodeURIComponent("阅读.md"),
          "x-lumen-scene": "technical_learning",
        }),
      }),
    );
  });

  it("使用文件夹清单和 multipart 上传 Markdown 目录", async () => {
    let capturedRequest: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, request?: RequestInit) => {
      capturedRequest = request;
      return Response.json({
      book: {
        bookId: "book-1", title: "Novel", sceneId: "technical_learning", formatId: "markdown", status: "ready",
        pageCount: 1, unreadAutoPageCount: 0, hasDailyReadingAutomation: false,
        createdAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z",
        pages: [{
          pageId: "page-1", order: 0, contentWeight: 4, origin: "folder_import",
          viewedAt: "2026-09-11T00:00:00.000Z",
          document: {
            documentId: "document-1", activeRevisionId: "revision-1", sceneId: "technical_learning", formatId: "markdown",
            title: "01", originalFilename: "01.md", byteSize: 4, status: "ready",
            createdAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z",
          },
        }],
      },
      documents: [{
        documentId: "document-1", activeRevisionId: "revision-1", sceneId: "technical_learning", formatId: "markdown",
        title: "01", originalFilename: "01.md", byteSize: 4, status: "ready",
        createdAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z",
      }],
      }, { status: 201 });
    });
    const markdown = new File(["# 01"], "01.md", { type: "text/markdown" });

    await importMarkdownFolder(
      "Novel",
      [{ file: markdown, relativePath: "chapters/01.md" }],
      "technical_learning",
      fetcher,
    );

    expect(capturedRequest?.body).toBeInstanceOf(FormData);
    const form = capturedRequest!.body as FormData;
    expect(JSON.parse(String(form.get("manifest")))).toEqual({
      folderName: "Novel",
      sceneId: "technical_learning",
      paths: ["chapters/01.md"],
    });
  });
});
