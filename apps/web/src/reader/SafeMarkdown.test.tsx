import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SafeMarkdown } from "./SafeMarkdown";

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
});
