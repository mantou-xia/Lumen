import { describe, expect, it, vi } from "vitest";

import { openReaderDocument } from "./reader";

describe("reader API", () => {
  it("按指定 Revision 打开历史阅读投影", async () => {
    const fetcher = vi.fn(async () => Response.json({
      document: {
        documentId: "document-1",
        activeRevisionId: "revision-2",
        sceneId: "english_reading",
        formatId: "markdown",
        title: "History",
        originalFilename: "history.md",
        byteSize: 32,
        status: "ready",
        createdAt: "2026-09-08T00:00:00.000Z",
        updatedAt: "2026-09-08T00:00:00.000Z",
      },
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
      renderHtml: "<p>Old</p>",
      blocks: [],
      outline: [],
      progress: null,
    }));

    await openReaderDocument("document-1", "revision-1", fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/reader/documents/document-1?revisionId=revision-1",
      { headers: { accept: "application/json" } },
    );
  });
});
