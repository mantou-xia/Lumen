import { describe, expect, it } from "vitest";

import { createConversationTurnRequestSchema } from "./conversation.js";

describe("conversation contract", () => {
  it("允许单一当前选区在空问题下触发默认解释", () => {
    expect(createConversationTurnRequestSchema.parse({
      references: [{
        type: "current_selection",
        start: { blockId: "block-1", offset: 0 },
        end: { blockId: "block-1", offset: 4 },
        selectedText: "REST",
      }],
    })).toMatchObject({ question: "", references: [{ type: "current_selection" }] });
  });

  it("拒绝空白选区", () => {
    expect(() => createConversationTurnRequestSchema.parse({
      references: [{
        type: "current_selection",
        start: { blockId: "block-1", offset: 0 },
        end: { blockId: "block-1", offset: 0 },
        selectedText: "",
      }],
    })).toThrow();
  });
});
