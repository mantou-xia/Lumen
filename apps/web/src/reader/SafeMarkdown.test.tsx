import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SafeMarkdown } from "./SafeMarkdown";

const reference = {
  referenceId: "reference-1",
  type: "selection" as const,
  targetId: null,
  label: "原文片段",
  content: "Context matters.",
  documentId: "document-1",
  revisionId: "revision-1",
  start: { blockId: "block-1", offset: 0 },
  end: { blockId: "block-1", offset: 16 },
  sourceRole: "explicit" as const,
};

describe("Workspace 安全 Markdown", () => {
  it("渲染受控格式并把原始 HTML 当作普通文本", () => {
    const html = renderToStaticMarkup(
      <SafeMarkdown content={"**重点** 与 `code`\n\n- 第一项\n- 第二项\n\n<script>alert(1)</script>"} />,
    );

    expect(html).toContain("<strong>重点</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<ul>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("只把 http 与 https 链接渲染为可点击链接", () => {
    const html = renderToStaticMarkup(
      <SafeMarkdown content={"[安全](https://example.com) [危险](javascript:alert(1))"} />,
    );

    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("危险");
  });

  it("只把回答中已解析的内部来源渲染为回跳按钮", () => {
    const html = renderToStaticMarkup(
      <SafeMarkdown
        content={"依据见[原文](lumen-reference:reference-1)，伪造见[未知](lumen-reference:missing)。"}
        references={[reference]}
        onReference={() => undefined}
      />,
    );

    expect(html).toContain("safe-markdown-reference");
    expect(html).toContain(">原文</button>");
    expect(html).toContain("未知");
    expect(html).not.toContain("lumen-reference:missing");
  });
});
