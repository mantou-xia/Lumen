import { describe, expect, it, vi } from "vitest";

import { DailyReadingSourceRegistry } from "./source-registry.js";

const longParagraph = "Robotics research is advancing through better perception, planning, and interaction with the physical world. ".repeat(20);

describe("DailyReadingSourceRegistry", () => {
  it("只从注册 Feed 发现候选并忠实转换正文", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/rss/topic/artificial-intelligence2")) {
        return new Response(`
          <rss><channel><item>
            <title>Embodied intelligence advances</title>
            <link>https://news.mit.edu/2026/embodied-intelligence-0912</link>
            <description>Robotics and AI research.</description>
            <pubDate>Sat, 12 Sep 2026 00:00:00 GMT</pubDate>
          </item></channel></rss>
        `, { headers: { "content-type": "application/rss+xml" } });
      }
      if (url === "https://news.mit.edu/2026/embodied-intelligence-0912") {
        return new Response(`<!doctype html><html><head><title>Embodied intelligence advances</title></head>
          <body><article><h1>Embodied intelligence advances</h1><p>${longParagraph}</p>
          <img src="https://news.mit.edu/image.jpg" alt="Robot demonstration"></article></body></html>`,
        { headers: { "content-type": "text/html" } });
      }
      return new Response("", { status: 503 });
    }) as unknown as typeof fetch;
    const registry = new DailyReadingSourceRegistry(fetcher);

    const candidates = await registry.discover();
    const article = await registry.extract(candidates[0]!);

    expect(candidates[0]).toMatchObject({ publisher: "MIT News" });
    expect(article?.markdown).toContain(longParagraph.trim());
    expect(article?.markdown).toContain("Image omitted: Robot demonstration");
    expect(article?.markdown).toContain("Original article");
  });

  it("拒绝文章跳转到来源白名单之外", async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://example.com/untrusted" },
    })) as unknown as typeof fetch;
    const registry = new DailyReadingSourceRegistry(fetcher);

    await expect(registry.extract({
      candidateId: "mit-news:1",
      sourceId: "mit-news",
      sourceVersion: "mit-news.v1",
      publisher: "MIT News",
      title: "Article",
      summary: "",
      url: "https://news.mit.edu/2026/article",
      publishedAt: null,
      imageMode: "reference_only",
      attribution: "Source: MIT News",
    })).rejects.toThrow(/超出允许主机/);
  });
});
