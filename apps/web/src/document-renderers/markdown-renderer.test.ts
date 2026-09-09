import { describe, expect, it } from "vitest";

import {
  normalizeSelectionParts,
  trimLeadingWhitespace,
  trimTrailingWhitespace,
} from "./markdown-renderer";

describe("Markdown Renderer 翻译范围显示", () => {
  it("只裁剪翻译范围首尾空白，不改变词语内部空格", () => {
    const text = "Read  with the heart  today.";
    expect(trimLeadingWhitespace(text, 4, 22)).toBe(6);
    expect(trimTrailingWhitespace(text, 4, 22)).toBe(20);
    expect(text.slice(6, 20)).toBe("with the heart");
  });

  it("提交选区前同步清理文本及语义偏移两端的空白", () => {
    expect(normalizeSelectionParts([{
      blockId: "block-1",
      start: 4,
      end: 22,
      text: "  with the heart  ",
    }])).toEqual({
      start: { blockId: "block-1", offset: 6 },
      end: { blockId: "block-1", offset: 20 },
      selectedText: "with the heart",
    });
  });
});
