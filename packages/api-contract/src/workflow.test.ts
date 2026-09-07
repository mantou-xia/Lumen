import { describe, expect, it } from "vitest";

import { recallEvaluationSchema } from "./recall.js";
import { readerDocumentSchema } from "./reader.js";
import { providerStatusSchema, translationResultSchema } from "./translation.js";

describe("Reader Workflow Contracts", () => {
  it("要求 Reader 投影携带版本、稳定块和安全渲染结果", () => {
    const parsed = readerDocumentSchema.parse({
      document: {
        documentId: "document-1",
        activeRevisionId: "revision-1",
        formatId: "markdown",
        title: "Reading",
        originalFilename: "reading.md",
        byteSize: 10,
        status: "ready",
        createdAt: "2026-09-07T00:00:00.000Z",
        updatedAt: "2026-09-07T00:00:00.000Z",
      },
      revision: {
        revisionId: "revision-1",
        adapterVersion: "markdown.adapter.v1",
        semanticProjectionVersion: "markdown.semantic.v1",
        renderProjectionVersion: "markdown.render.v1",
        sourceMappingVersion: "markdown.source-map.v1",
      },
      renderHtml: "<p data-block-id=\"block-1\">Read</p>",
      blocks: [{
        blockId: "block-1",
        blockType: "paragraph",
        order: 0,
        text: "Read",
        sourceRange: { startOffset: 0, endOffset: 4 },
      }],
      outline: [],
      progress: null,
    });
    expect(parsed.blocks[0]?.blockId).toBe("block-1");
  });

  it("拒绝缺少结构字段的翻译和 Recall 正式结果", () => {
    expect(() => translationResultSchema.parse({ contextualTranslation: "翻译" })).toThrow();
    expect(() => recallEvaluationSchema.parse({ verdict: "understood" })).toThrow();
  });

  it("允许 DeepSeek 与通用 OpenAI-compatible Provider 状态", () => {
    expect(providerStatusSchema.parse({
      configured: false,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
    }).provider).toBe("deepseek");
    expect(providerStatusSchema.parse({
      configured: true,
      provider: "openai-compatible",
      model: "relay-model",
      baseUrl: "https://relay.example/v1",
    }).provider).toBe("openai-compatible");
  });
});
