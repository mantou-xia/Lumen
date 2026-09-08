import { describe, expect, it } from "vitest";

import { createReaderInstanceId, sameSelectionCandidate } from "./reading-session";

const candidate = {
  start: { blockId: "block-1", offset: 2 },
  end: { blockId: "block-1", offset: 7 },
  selectedText: "Lumen",
};

describe("Reader session identity", () => {
  it("为不同 Reader 实例生成不同身份", () => {
    expect(createReaderInstanceId()).not.toBe(createReaderInstanceId());
  });

  it("只有完整语义范围和文本一致时才视为同一选区", () => {
    expect(sameSelectionCandidate(candidate, { ...candidate })).toBe(true);
    expect(sameSelectionCandidate(candidate, {
      ...candidate,
      end: { ...candidate.end, offset: 8 },
    })).toBe(false);
    expect(sameSelectionCandidate(candidate, {
      ...candidate,
      selectedText: "lumen",
    })).toBe(false);
  });
});
