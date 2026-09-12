import { describe, expect, it } from "vitest";

import { recallEvaluationSchema } from "./recall.js";
import { operationSchema } from "./operation.js";
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
        sceneId: "english_reading",
        originalFilename: "reading.md",
        byteSize: 10,
        status: "ready",
        createdAt: "2026-09-07T00:00:00.000Z",
        updatedAt: "2026-09-07T00:00:00.000Z",
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
      renderHtml: "<p data-block-id=\"block-1\">Read</p>",
      blocks: [{
        blockId: "block-1",
        blockType: "table_cell",
        order: 0,
        text: "Read",
        sourceRange: { startOffset: 0, endOffset: 4 },
      }],
      outline: [],
      progress: null,
    });
    expect(parsed.blocks[0]).toMatchObject({ blockId: "block-1", blockType: "table_cell" });
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

  it("Operation 查询包含终态、事件序列和全部 Invocation", () => {
    const operation = operationSchema.parse({
      operationId: "operation-1",
      previousOperationId: null,
      taskType: "selection.translation",
      taskVersion: "selection.translation.v1",
      status: "completed",
      documentId: "document-1",
      revisionId: "revision-1",
      cacheKey: null,
      latestSequence: 0,
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:01.000Z",
      completedAt: "2026-09-08T00:00:01.000Z",
      invocations: [{
        invocationId: "invocation-1",
        attemptNumber: 1,
        providerId: "deepseek",
        modelId: "deepseek-chat",
        status: "succeeded",
        inputTokens: 10,
        outputTokens: 20,
        latencyMs: 100,
        errorCode: null,
        errorMessage: null,
        startedAt: "2026-09-08T00:00:00.000Z",
        completedAt: "2026-09-08T00:00:01.000Z",
      }],
    });
    expect(operation.invocations[0]?.attemptNumber).toBe(1);
  });

  it("Operation 事件查询使用单调 sequence 增量恢复", async () => {
    const { operationEventListSchema, operationEventQuerySchema } = await import("./operation.js");
    expect(operationEventQuerySchema.parse({ after: "3" })).toEqual({
      after: 3,
      limit: 100,
    });
    expect(operationEventListSchema.parse({
      events: [{
        operationId: "operation-1",
        sequence: 4,
        eventType: "invocation.running",
        payload: { attemptNumber: 2 },
        createdAt: "2026-09-08T00:00:00.000Z",
      }],
    }).events[0]?.sequence).toBe(4);
  });
});
