import { describe, expect, it } from "vitest";

import { MarkdownDocumentAdapter } from "./markdown-adapter.js";

describe("MarkdownDocumentAdapter", () => {
  it("从同一 AST 生成安全渲染、语义块、目录和 Source Mapping", async () => {
    const artifact = await new MarkdownDocumentAdapter().import(
      [
        "# Reading deeply",
        "",
        "A paragraph with **strong meaning** and [a link](https://example.com).",
        "",
        "> Stay curious.",
        "",
        "- First expression",
        "- Second expression",
        "",
        "```ts",
        "const answer = 42;",
        "```",
      ].join("\n"),
      "revision-1",
    );

    expect(artifact.outline).toEqual([
      expect.objectContaining({ blockId: "revision-1:block:0", depth: 1, label: "Reading deeply" }),
    ]);
    expect(artifact.blocks.map((block) => block.blockType)).toEqual([
      "heading",
      "paragraph",
      "blockquote",
      "list_item",
      "list_item",
      "code",
    ]);
    expect(artifact.blocks[1]).toMatchObject({
      text: "A paragraph with strong meaning and a link.",
      sourceRange: { startOffset: 18 },
    });
    expect(artifact.renderHtml).toContain('data-block-id="revision-1:block:0"');
    expect(artifact.renderHtml).toContain("<strong>strong meaning</strong>");
  });

  it("丢弃原始 HTML、危险协议并阻止外部图片加载", async () => {
    const artifact = await new MarkdownDocumentAdapter().import(
      [
        "# Safety",
        "",
        '<script>alert("bad")</script>',
        "",
        '<img src=x onerror=alert("bad")>',
        "",
        "[danger](javascript:alert(1))",
        "",
        "![cover](https://example.com/tracker.png)",
      ].join("\n"),
      "revision-safe",
    );

    expect(artifact.renderHtml).not.toContain("<script");
    expect(artifact.renderHtml).not.toContain("<img");
    expect(artifact.renderHtml).not.toContain('href="javascript:');
    expect(artifact.renderHtml).not.toContain("tracker.png");
    expect(artifact.renderHtml).toContain("外部图片已阻止：cover");
  });
});
