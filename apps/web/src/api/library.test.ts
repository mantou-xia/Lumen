import { describe, expect, it, vi } from "vitest";

import { getDocuments, importMarkdown } from "./library";

describe("library API", () => {
  it("解析文档列表响应", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        documents: [
          {
            documentId: "document-1",
            activeRevisionId: "revision-1",
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

    await importMarkdown(file, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/imports",
      expect.objectContaining({
        method: "POST",
        body: file,
        headers: expect.objectContaining({ "x-lumen-filename": encodeURIComponent("阅读.md") }),
      }),
    );
  });
});
