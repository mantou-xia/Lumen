import { describe, expect, it } from "vitest";

import { buildAnchoredAssistResults } from "./anchored-assist-projection";

const translation = {
  translationId: "translation-1",
  operationId: "operation-1",
  revisionId: "revision-1",
  start: { blockId: "block-1", offset: 0 },
  end: { blockId: "block-1", offset: 4 },
  selectedText: "REST",
  fingerprint: "fingerprint-1",
  createdAt: "2026-09-13T00:00:00.000Z",
};

const explanation = {
  footnoteId: "footnote-1",
  documentId: "document-1",
  revisionId: "revision-1",
  conversationId: "conversation-1",
  turnId: "turn-1",
  capabilityId: "selection.technical-explanation.v1",
  selectionFingerprint: "fingerprint-1",
  selectedText: "REST",
  start: { blockId: "block-1", offset: 0 },
  end: { blockId: "block-1", offset: 4 },
  status: "active" as const,
  createdAt: "2026-09-13T00:01:00.000Z",
  updatedAt: "2026-09-13T00:01:00.000Z",
};

describe("原文辅助结果投影", () => {
  it("同一选区在英文阅读优先显示翻译，在技术学习优先显示解释", () => {
    const base = { documentId: "document-1", translations: [translation], explanations: [explanation] };
    expect(buildAnchoredAssistResults({ ...base, sceneId: "english_reading" })[0]).toMatchObject({
      resultType: "translation",
      translationId: "translation-1",
      relatedResult: {
        resultType: "explanation",
        footnoteId: "footnote-1",
        conversationId: "conversation-1",
        turnId: "turn-1",
      },
    });
    expect(buildAnchoredAssistResults({ ...base, sceneId: "technical_learning" })[0]).toMatchObject({
      resultType: "explanation",
      conversationId: "conversation-1",
      turnId: "turn-1",
      relatedResult: { resultType: "translation", translationId: "translation-1" },
    });
  });

  it("保留多个不同语义范围，不因场景主结果选择互相覆盖", () => {
    const secondTranslation = {
      ...translation,
      translationId: "translation-2",
      operationId: "operation-2",
      fingerprint: "fingerprint-2",
      selectedText: "HTTP",
      start: { blockId: "block-2", offset: 0 },
      end: { blockId: "block-2", offset: 4 },
    };
    const results = buildAnchoredAssistResults({
      documentId: "document-1",
      sceneId: "technical_learning",
      translations: [translation, secondTranslation],
      explanations: [explanation],
    });
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.selectionFingerprint)).toEqual([
      "fingerprint-1",
      "fingerprint-2",
    ]);
    expect(results[1]).toMatchObject({
      resultType: "translation",
      translationId: "translation-2",
      relatedResult: null,
    });
  });
});
