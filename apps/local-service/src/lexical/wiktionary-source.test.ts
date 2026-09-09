import { describe, expect, it, vi } from "vitest";

import { WiktionarySource } from "./wiktionary-source.js";

describe("WiktionarySource", () => {
  it("通过 MediaWiki Action API 获取带版本信息的原始词条", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      query: {
        pages: [{
          pageid: 123,
          title: "sophisticated",
          revisions: [{
            revid: 456,
            timestamp: "2026-09-08T00:00:00.000Z",
            slots: { main: { content: "==English==\n===Adjective===\n# Complex." } },
          }],
        }],
      },
    }), { status: 200 }));
    const source = new WiktionarySource("https://example.test/w/api.php", fetcher);

    await expect(source.fetchEntry("sophisticated")).resolves.toMatchObject({
      entryId: "en.wiktionary:123",
      lemma: "sophisticated",
      revisionId: "456",
    });
    const requestedUrl = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(requestedUrl.searchParams.get("rvprop")).toBe("ids|timestamp|content");
    expect(requestedUrl.searchParams.get("titles")).toBe("sophisticated");
  });

  it("网络失败时返回稳定的可重试错误", async () => {
    const source = new WiktionarySource(
      "https://example.test/w/api.php",
      async () => { throw new TypeError("offline"); },
    );

    await expect(source.fetchEntry("sophisticated")).rejects.toMatchObject({
      code: "LEXICAL_SOURCE_UNAVAILABLE",
      retryable: true,
    });
  });

  it("来源长时间无响应时按超时返回可重试错误", async () => {
    const source = new WiktionarySource(
      "https://example.test/w/api.php",
      async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
      10,
    );

    await expect(source.fetchEntry("previous")).rejects.toMatchObject({
      code: "LEXICAL_SOURCE_UNAVAILABLE",
      retryable: true,
    });
  });
});
