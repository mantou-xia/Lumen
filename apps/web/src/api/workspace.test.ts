import { describe, expect, it, vi } from "vitest";

import { askWorkspace, getWorkspace, openWorkspace } from "./workspace";

const session = {
  sessionId: "session-1",
  documentId: "document-1",
  revisionId: "revision-1",
  title: "新会话",
  turns: [],
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
};

describe("workspace API", () => {
  it("打开、恢复 Session 并提交带显式 Reference 的回合", async () => {
    const turn = {
      turnId: "turn-1",
      question: "这一段在说什么？",
      references: [{
        referenceId: "reference-1",
        type: "paragraph",
        targetId: "block-1",
        label: "段落：Context matters.",
        content: "Context matters.",
        documentId: "document-1",
        revisionId: "revision-1",
        start: { blockId: "block-1", offset: 0 },
        end: { blockId: "block-1", offset: 16 },
        sourceRole: "explicit",
      }],
      contextReferences: [],
      answer: {
        answerId: "answer-1",
        operationId: "operation-1",
        content: "这里强调语境。",
        citationReferenceIds: ["reference-1"],
        outcome: "answered",
        contextMode: "explicit_references_only",
        contextStats: {
          explicitReferenceCount: 1,
          retrievedBlockCount: 0,
          includedCharacterCount: 16,
          truncated: false,
        },
        createdAt: "2026-09-08T00:00:01.000Z",
      },
      createdAt: "2026-09-08T00:00:00.000Z",
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/turns")) return Response.json(turn);
      return Response.json(session);
    });

    await expect(openWorkspace("document-1", "revision-1", fetcher))
      .resolves.toMatchObject({ sessionId: "session-1" });
    await expect(getWorkspace("session-1", fetcher))
      .resolves.toMatchObject({ documentId: "document-1" });
    await expect(askWorkspace("session-1", {
      question: "这一段在说什么？",
      references: [{ type: "paragraph", targetId: "block-1" }],
    }, undefined, fetcher)).resolves.toMatchObject({ turnId: "turn-1" });
    expect(fetcher).toHaveBeenLastCalledWith(
      "/api/workspaces/session-1/turns",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
