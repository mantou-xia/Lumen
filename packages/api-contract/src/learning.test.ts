import { describe, expect, it } from "vitest";

import {
  learningExpressionDetailSchema,
  learningExpressionListSchema,
  learningListQuerySchema,
} from "./learning.js";

describe("learning contract", () => {
  it("为服务端列表查询提供受限默认分页和排序", () => {
    expect(learningListQuerySchema.parse({})).toEqual({
      query: "",
      sort: "updated_desc",
      limit: 12,
    });
    expect(() => learningListQuerySchema.parse({ limit: 51 })).toThrow();
  });

  it("区分聚合摘要与包含历史快照的表达详情", () => {
    expect(learningExpressionListSchema.parse({
      items: [],
      nextCursor: null,
      totalExpressions: 0,
      totalContexts: 0,
    })).toMatchObject({ items: [], nextCursor: null });

    expect(learningExpressionDetailSchema.parse({
      expressionId: "expression-1",
      canonicalForm: "sophisticated",
      normalizedForm: "sophisticated",
      expressionType: "word",
      status: "active",
      userNote: "",
      lexicalProfile: null,
      lexicalLocalization: null,
      contexts: [{
        learningContextId: "context-1",
        expressionId: "expression-1",
        translationId: "translation-1",
        documentId: "document-1",
        documentTitle: "A Document",
        revisionId: "revision-1",
        locationLabel: "Chapter One",
        startBlockId: "block-1",
        startOffset: 2,
        endBlockId: "block-1",
        endOffset: 15,
        surfaceForm: "sophisticated",
        surroundingContext: "a sophisticated system",
        contextualTranslation: "一个复杂精密的系统",
        contextualMeaning: "技术上复杂且成熟",
        explanation: "修饰系统能力。",
        uncertainty: "",
        translationOperationId: "operation-1",
        status: "active",
        userNote: "",
        createdAt: "2026-09-08T00:00:00.000Z",
        updatedAt: "2026-09-08T00:00:00.000Z",
      }],
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:00.000Z",
    }).contexts[0]?.revisionId).toBe("revision-1");
  });
});
