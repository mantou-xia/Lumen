import { describe, expect, it } from "vitest";
import type { AiFootnote, ReadingConversation } from "@lumen/api-contract";

import { findFootnoteConversation } from "./explanation-conversation";

function conversation(conversationId: string, turnId: string): ReadingConversation {
  return {
    conversationId,
    sceneId: "technical_learning",
    documentId: "document-1",
    revisionId: "revision-1",
    title: conversationId,
    turns: [{
      turnId,
      question: "",
      intent: "explain",
      capabilityId: "selection.technical-explanation.v1",
      footnoteEligible: true,
      references: [],
      answer: {
        answerId: `answer-${turnId}`,
        operationId: `operation-${turnId}`,
        content: `answer-${turnId}`,
        citationReferenceIds: [],
        outcome: "answered",
        knowledgeBoundary: "mixed",
        createdAt: "2026-09-13T00:00:01.000Z",
      },
      footnote: null,
      createdAt: "2026-09-13T00:00:00.000Z",
    }],
    footnotes: [],
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:01.000Z",
  };
}

function footnote(conversationId: string, turnId: string): AiFootnote {
  return {
    footnoteId: `footnote-${turnId}`,
    documentId: "document-1",
    revisionId: "revision-1",
    conversationId,
    turnId,
    capabilityId: "selection.technical-explanation.v1",
    selectionFingerprint: `fingerprint-${turnId}`,
    selectedText: turnId,
    start: { blockId: "block-1", offset: 0 },
    end: { blockId: "block-1", offset: 4 },
    status: "active",
    createdAt: "2026-09-13T00:00:01.000Z",
    updatedAt: "2026-09-13T00:00:01.000Z",
  };
}

describe("解释所属 Conversation", () => {
  it("当前对话是最新对话时，旧解释仍严格匹配旧 Conversation 和 Turn", () => {
    const oldConversation = conversation("conversation-old", "turn-old");
    const latestConversation = conversation("conversation-latest", "turn-latest");

    expect(findFootnoteConversation(
      footnote("conversation-old", "turn-old"),
      [latestConversation, oldConversation],
    )).toMatchObject({
      conversation: { conversationId: "conversation-old" },
      turn: { turnId: "turn-old", answer: { content: "answer-turn-old" } },
    });
  });

  it("不会用另一 Conversation 中同位置或其他 Turn 代替注脚所属 Turn", () => {
    const latestConversation = conversation("conversation-latest", "turn-latest");
    expect(findFootnoteConversation(
      footnote("conversation-old", "turn-old"),
      [latestConversation],
    )).toBeNull();
  });
});
