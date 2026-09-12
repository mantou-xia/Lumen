import { describe, expect, it } from "vitest";

import { documentListResponseSchema, importDocumentResponseSchema } from "./library.js";

const document = {
  documentId: "doc-1",
  activeRevisionId: "revision-1",
  formatId: "markdown",
  title: "Reading Notes",
  sceneId: "english_reading",
  originalFilename: "reading-notes.md",
  byteSize: 128,
  status: "ready",
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
} as const;

describe("Library Contract", () => {
  it("接受可展示的文档列表", () => {
    expect(documentListResponseSchema.parse({ documents: [document] }).documents).toHaveLength(1);
  });

  it("要求成功导入同时返回完成 Operation 和 Document", () => {
    expect(
      importDocumentResponseSchema.parse({
        document,
        operation: {
          operationId: "import-1",
          kind: "new_document",
          status: "completed",
          originalFilename: "reading-notes.md",
          documentId: "doc-1",
          errorCode: null,
          errorMessage: null,
          createdAt: "2026-09-07T00:00:00.000Z",
          updatedAt: "2026-09-07T00:00:01.000Z",
          completedAt: "2026-09-07T00:00:01.000Z",
        },
      }).operation.status,
    ).toBe("completed");
  });
});
