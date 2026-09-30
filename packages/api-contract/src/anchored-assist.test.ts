import { describe, expect, it } from "vitest";

import { anchoredAssistResultSchema } from "./anchored-assist.js";

describe("anchored assist contract", () => {
  it("用同一范围协议表达翻译与解释结果", () => {
    const result = anchoredAssistResultSchema.parse({
      resultId: "translation:translation-1",
      resultType: "translation",
      translationId: "translation-1",
      operationId: "operation-1",
      documentId: "document-1",
      revisionId: "revision-1",
      selectionFingerprint: "fingerprint-1",
      selectedText: "REST",
      start: { blockId: "block-1", offset: 0 },
      end: { blockId: "block-1", offset: 4 },
      createdAt: "2026-09-13T00:00:00.000Z",
      relatedResult: null,
    });
    expect(result.resultType).toBe("translation");
  });

  it("解释结果保留打开对应 Conversation Turn 所需身份", () => {
    const result = anchoredAssistResultSchema.parse({
      resultId: "explanation:footnote-1",
      resultType: "explanation",
      footnoteId: "footnote-1",
      conversationId: "conversation-1",
      turnId: "turn-1",
      capabilityId: "selection.technical-explanation.v1",
      documentId: "document-1",
      revisionId: "revision-1",
      selectionFingerprint: "fingerprint-1",
      selectedText: "REST",
      start: { blockId: "block-1", offset: 0 },
      end: { blockId: "block-1", offset: 4 },
      createdAt: "2026-09-13T00:00:00.000Z",
      relatedResult: {
        resultId: "translation:translation-1",
        resultType: "translation",
        translationId: "translation-1",
        operationId: "operation-1",
      },
    });
    expect(result).toMatchObject({
      resultType: "explanation",
      footnoteId: "footnote-1",
      conversationId: "conversation-1",
      turnId: "turn-1",
      relatedResult: { resultType: "translation", translationId: "translation-1" },
    });
  });
});
