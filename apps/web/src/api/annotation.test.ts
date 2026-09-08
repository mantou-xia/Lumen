import { describe, expect, it, vi } from "vitest";

import {
  archiveAnnotation,
  createAnnotation,
  getAnnotations,
  updateAnnotation,
} from "./annotation";

const annotation = {
  annotationId: "annotation-1",
  documentId: "document-1",
  revisionId: "revision-1",
  start: { blockId: "block-1", offset: 2 },
  end: { blockId: "block-1", offset: 8 },
  selectedText: "reader",
  sourceRanges: [{
    blockId: "block-1",
    semanticStartOffset: 2,
    semanticEndOffset: 8,
    source: { kind: "markdown-offset", startOffset: 12, endOffset: 18 },
  }],
  note: "",
  source: { type: "selection" },
  status: "active",
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
};

describe("annotation API", () => {
  it("创建、查询、更新并归档标注", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/annotations/query")) {
        return Response.json({ annotations: [annotation] });
      }
      return Response.json({
        ...annotation,
        note: init?.method === "PATCH" ? "笔记" : annotation.note,
        status: url.endsWith("/archive") ? "archived" : annotation.status,
      });
    });

    await createAnnotation(
      "document-1",
      "revision-1",
      { start: annotation.start, end: annotation.end, selectedText: annotation.selectedText },
      { type: "selection" },
      fetcher,
    );
    await expect(getAnnotations("document-1", "revision-1", ["block-1"], fetcher))
      .resolves.toHaveLength(1);
    await expect(updateAnnotation("annotation-1", "笔记", fetcher))
      .resolves.toMatchObject({ note: "笔记" });
    await expect(archiveAnnotation("annotation-1", fetcher))
      .resolves.toMatchObject({ status: "archived" });
  });
});
