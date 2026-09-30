import { describe, expect, it, vi } from "vitest";

import { getConversation } from "./conversation";

function conversation(conversationId: string, turnId: string) {
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

describe("conversation API", () => {
  it("按 conversationId 分别恢复两个对话", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const conversationId = String(input).split("/").at(-1)!;
      return Response.json(conversation(conversationId, `turn-${conversationId}`));
    });

    await expect(getConversation("conversation-old", fetcher))
      .resolves.toMatchObject({ conversationId: "conversation-old", turns: [{ turnId: "turn-conversation-old" }] });
    await expect(getConversation("conversation-latest", fetcher))
      .resolves.toMatchObject({ conversationId: "conversation-latest", turns: [{ turnId: "turn-conversation-latest" }] });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/conversations/conversation-old",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
  });
});
