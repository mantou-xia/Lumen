import { describe, expect, it } from "vitest";

import { excludeTranslatedRecallMatches } from "./highlight-policy";

const blocks = [
  { blockId: "block-1", blockType: "paragraph" as const, order: 0, text: "Read with the heart today.", sourceRange: { startOffset: 0, endOffset: 26 } },
  { blockId: "block-2", blockType: "paragraph" as const, order: 1, text: "Use the same expression again.", sourceRange: { startOffset: 27, endOffset: 57 } },
];

const translated = {
  translationId: "translation-1",
  operationId: "operation-1",
  revisionId: "revision-1",
  start: { blockId: "block-1", offset: 4 },
  end: { blockId: "block-1", offset: 20 },
  selectedText: " with the heart ",
  fingerprint: "a".repeat(64),
  createdAt: "2026-09-09T00:00:00.000Z",
};

const recalled = {
  expressionId: "expression-1",
  canonicalForm: "with the heart",
  matchedVariantId: "variant-1",
  blockId: "block-1",
  startOffset: 5,
  endOffset: 19,
  surfaceForm: "with the heart",
  matchType: "exact" as const,
};

describe("Reader 高亮优先级", () => {
  it("已翻译范围覆盖 Recall 时只保留翻译交互", () => {
    expect(excludeTranslatedRecallMatches([recalled], [translated], blocks)).toEqual([]);
  });

  it("同一表达出现在未翻译位置时仍保留 Recall", () => {
    const nextOccurrence = { ...recalled, blockId: "block-2", startOffset: 8, endOffset: 22 };
    expect(excludeTranslatedRecallMatches([nextOccurrence], [translated], blocks))
      .toEqual([nextOccurrence]);
  });
});
