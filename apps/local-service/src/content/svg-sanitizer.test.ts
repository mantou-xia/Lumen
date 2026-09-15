import { describe, expect, it } from "vitest";

import { sanitizeSvg } from "./svg-sanitizer.js";

function sanitize(source: string): string | null {
  const result = sanitizeSvg(new TextEncoder().encode(source));
  return result === null ? null : new TextDecoder().decode(result);
}

describe("SVG 安全净化", () => {
  it("保留静态绘图标签、内部 marker 和文本", () => {
    const result = sanitize(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80" style="background:#fff">
        <defs><marker id="arrow"><path d="M0 0 L10 5 L0 10" fill="#333"/></marker></defs>
        <line x1="0" y1="10" x2="80" y2="10" marker-end="url(#arrow)" stroke="#333"/>
        <text x="4" y="40" font-family="Arial">Agent &amp; Tool</text>
      </svg>
    `);

    expect(result).toContain('viewBox="0 0 100 80"');
    expect(result).toContain('style="background:#fff"');
    expect(result).toContain('marker-end="url(#arrow)"');
    expect(result).toContain("Agent &amp; Tool");
  });

  it("移除脚本、事件、foreignObject 和外部资源", () => {
    const result = sanitize(`
      <svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
        <script>alert(1)</script>
        <foreignObject><div>danger</div></foreignObject>
        <use href="https://example.com/icon.svg#x"/>
        <rect width="10" height="10" fill="url(https://example.com/a.svg#x)" onclick="alert(2)"/>
      </svg>
    `);

    expect(result).not.toBeNull();
    expect(result).not.toContain("script");
    expect(result).not.toContain("foreignObject");
    expect(result).not.toContain("onload");
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("https://");
  });

  it("拒绝 DOCTYPE、实体声明和无效 XML", () => {
    expect(sanitize('<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg>&xxe;</svg>'))
      .toBeNull();
    expect(sanitize("<svg><g></svg>")).toBeNull();
  });
});
