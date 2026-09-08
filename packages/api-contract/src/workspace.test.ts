import { describe, expect, it } from "vitest";

import {
  createWorkspaceTurnRequestSchema,
  workspaceSessionSchema,
} from "./workspace.js";

describe("workspace contract", () => {
  it("要求每个回合至少包含一个显式 Reference", () => {
    expect(() => createWorkspaceTurnRequestSchema.parse({
      question: "这句话为什么这样表达？",
      references: [],
    })).toThrow();
    expect(createWorkspaceTurnRequestSchema.parse({
      question: "这句话为什么这样表达？",
      references: [{ type: "translation", targetId: "translation-1" }],
    }).references).toHaveLength(1);
    expect(createWorkspaceTurnRequestSchema.parse({
      question: "这个选区和段落有什么关系？",
      references: [
        {
          type: "selection",
          start: { blockId: "block-1", offset: 0 },
          end: { blockId: "block-1", offset: 7 },
          selectedText: "example",
        },
        { type: "paragraph", targetId: "block-1" },
      ],
    }).references).toHaveLength(2);
  });

  it("Session、Turn、Answer 与引用快照形成可恢复结构", () => {
    expect(workspaceSessionSchema.parse({
      sessionId: "session-1",
      documentId: "document-1",
      revisionId: "revision-1",
      turns: [{
        turnId: "turn-1",
        question: "它在这里是什么意思？",
        references: [{
          referenceId: "reference-1",
          type: "translation",
          targetId: "translation-1",
          label: "翻译：example",
          content: "example 在当前语境中的含义",
          documentId: "document-1",
          revisionId: "revision-1",
          start: { blockId: "block-1", offset: 0 },
          end: { blockId: "block-1", offset: 7 },
        }],
        answer: {
          answerId: "answer-1",
          operationId: "operation-1",
          content: "这里强调具体语境。",
          citationReferenceIds: ["reference-1"],
          createdAt: "2026-09-08T00:00:01.000Z",
        },
        createdAt: "2026-09-08T00:00:00.000Z",
      }],
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:01.000Z",
    }).turns[0]?.answer.operationId).toBe("operation-1");
  });
});
