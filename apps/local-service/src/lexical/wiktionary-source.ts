import { z } from "zod";

import { ApplicationError } from "../application/errors.js";
import type { LexicalSourcePort } from "../application/ports.js";
import type { WiktionarySourceEntry } from "./wiktionary-parser.js";

const responseSchema = z.object({
  query: z.object({
    pages: z.array(z.object({
      pageid: z.number().optional(),
      title: z.string(),
      missing: z.boolean().optional(),
      revisions: z.array(z.object({
        revid: z.number(),
        timestamp: z.string().datetime(),
        slots: z.object({ main: z.object({ content: z.string() }) }),
      })).optional(),
    })),
  }),
});

export class WiktionarySource implements LexicalSourcePort {
  constructor(
    private readonly apiUrl = "https://en.wiktionary.org/w/api.php",
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly requestTimeoutMs = 15_000,
  ) {}

  async fetchEntry(lemma: string, signal?: AbortSignal): Promise<WiktionarySourceEntry | null> {
    const url = new URL(this.apiUrl);
    url.search = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      prop: "revisions",
      redirects: "1",
      rvprop: "ids|timestamp|content",
      rvslots: "main",
      titles: lemma,
    }).toString();

    try {
      const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
      const requestSignal = signal === undefined
        ? timeoutSignal
        : AbortSignal.any([signal, timeoutSignal]);
      const response = await this.fetchImplementation(url, {
        headers: { "user-agent": "Lumen/0.1.0 Wiktionary lexical profile lookup" },
        signal: requestSignal,
      });
      if (!response.ok) throw new Error(`Wiktionary HTTP ${response.status}`);
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) throw parsed.error;
      const page = parsed.data.query.pages[0];
      const revision = page?.revisions?.[0];
      if (page === undefined || page.missing === true || revision === undefined) return null;
      return {
        entryId: `en.wiktionary:${page.pageid ?? page.title.toLocaleLowerCase("en-US")}`,
        lemma: page.title,
        revisionId: String(revision.revid),
        revisionTimestamp: revision.timestamp,
        sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(page.title.replaceAll(" ", "_"))}`,
        wikitext: revision.slots.main.content,
      };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if (signal?.aborted === true) {
        throw new ApplicationError({
          code: "OPERATION_CANCELLED",
          message: "词汇资料请求已取消",
          statusCode: 499,
          cause: error,
        });
      }
      throw new ApplicationError({
        code: "LEXICAL_SOURCE_UNAVAILABLE",
        message: "无法连接 Wiktionary 获取词汇资料",
        statusCode: 503,
        retryable: true,
        cause: error,
      });
    }
  }
}
