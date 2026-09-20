import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

export interface DailyReadingCandidate {
  candidateId: string;
  sourceId: string;
  sourceVersion: string;
  publisher: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string | null;
  imageMode: "reference_only" | "nasa_managed";
  attribution: string;
}

export interface DailyReadingArticle extends DailyReadingCandidate {
  author: string | null;
  markdown: string;
  canonicalUrl: string;
  retrievedAt: string;
}

interface SourceDefinition {
  sourceId: string;
  sourceVersion: string;
  publisher: string;
  feeds: string[];
  allowedArticleHosts: string[];
  imageMode: DailyReadingCandidate["imageMode"];
  attribution: string;
}

const sources: SourceDefinition[] = [
  {
    sourceId: "mit-news",
    sourceVersion: "mit-news.v1",
    publisher: "MIT News",
    feeds: [
      "https://news.mit.edu/rss/topic/artificial-intelligence2",
      "https://news.mit.edu/rss/topic/robotics",
    ],
    allowedArticleHosts: ["news.mit.edu"],
    imageMode: "reference_only",
    attribution: "Source: MIT News. Original wording retained for personal reading.",
  },
  {
    sourceId: "global-voices",
    sourceVersion: "global-voices.v1",
    publisher: "Global Voices",
    feeds: ["https://globalvoices.org/feed/"],
    allowedArticleHosts: ["globalvoices.org", "www.globalvoices.org"],
    imageMode: "reference_only",
    attribution: "Global Voices content is attributed under its stated CC BY 3.0 policy; third-party media is excluded.",
  },
  {
    sourceId: "nasa",
    sourceVersion: "nasa.v1",
    publisher: "NASA",
    feeds: ["https://www.nasa.gov/rss/dyn/breaking_news.rss"],
    allowedArticleHosts: ["www.nasa.gov", "science.nasa.gov"],
    imageMode: "nasa_managed",
    attribution: "Source: NASA. Third-party credited media remains excluded.",
  },
];

const decodeEntities = (value: string): string => {
  const { document } = parseHTML(`<html><body>${value}</body></html>`);
  return document.body.textContent?.trim() ?? "";
};

const tagValue = (item: string, names: string[]): string | null => {
  for (const name of names) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "iu").exec(item);
    if (match?.[1] !== undefined) return decodeEntities(match[1].replace(/^<!\[CDATA\[|\]\]>$/gu, ""));
  }
  return null;
};

function safeIsoDate(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export class DailyReadingSourceRegistry {
  constructor(private readonly fetcher: typeof fetch) {}

  async discover(signal?: AbortSignal): Promise<DailyReadingCandidate[]> {
    const results = await Promise.allSettled(sources.flatMap((source) =>
      source.feeds.map((feed) => this.discoverFeed(source, feed, signal)),
    ));
    const candidates = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    return [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()].slice(0, 40);
  }

  async extract(candidate: DailyReadingCandidate, signal?: AbortSignal): Promise<DailyReadingArticle | null> {
    const url = new URL(candidate.url);
    const definition = sources.find((source) => source.sourceId === candidate.sourceId);
    if (definition === undefined || !definition.allowedArticleHosts.includes(url.hostname)) return null;
    const response = await this.fetchAllowed(url, definition.allowedArticleHosts, {
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Lumen/0.1 daily-reading" },
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("text/html")) return null;
    const html = await response.text();
    if (html.length > 5_000_000) return null;
    const { document } = parseHTML(html);
    const article = new Readability(document as unknown as Document, { charThreshold: 500 }).parse();
    if (article === null || (article.textContent ?? "").trim().length < 1_200) return null;
    const articleDocument = parseHTML(`<article>${article.content}</article>`).document;
    for (const image of [...articleDocument.querySelectorAll("img")]) {
      const sourceUrl = image.getAttribute("src") ?? "";
      const alt = image.getAttribute("alt")?.trim() || "Article image";
      const absolute = (() => {
        try { return new URL(sourceUrl, url).toString(); } catch { return null; }
      })();
      const nasaAllowed = candidate.imageMode === "nasa_managed"
        && absolute !== null
        && ["www.nasa.gov", "science.nasa.gov", "images-assets.nasa.gov"].includes(new URL(absolute).hostname)
        && !/reuters|associated press|\bap\b|getty/iu.test(image.parentElement?.textContent ?? "");
      if (nasaAllowed && absolute !== null) {
        image.setAttribute("src", absolute);
      } else {
        const note = articleDocument.createElement("p");
        note.textContent = `Image omitted: ${alt}. View it on the original article page.`;
        image.replaceWith(note);
      }
    }
    for (const element of [...articleDocument.querySelectorAll("script,style,iframe,form,button,noscript")]) {
      element.remove();
    }
    const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });
    const retrievedAt = new Date().toISOString();
    const author = article.byline?.trim() || null;
    const markdownBody = turndown.turndown(articleDocument.querySelector("article")?.innerHTML ?? "");
    if (markdownBody.replace(/\s/gu, "").length < 1_000) return null;
    const metadata = [
      "---",
      "## Source",
      "",
      `- **Publisher:** ${candidate.publisher}`,
      ...(author === null ? [] : [`- **Author:** ${author}`]),
      ...(candidate.publishedAt === null ? [] : [`- **Published:** ${candidate.publishedAt}`]),
      `- **Retrieved:** ${retrievedAt}`,
      `- **Original article:** [${candidate.title}](${candidate.url})`,
      `- **Attribution:** ${candidate.attribution}`,
    ].join("\n");
    return {
      ...candidate,
      author,
      canonicalUrl: response.url || candidate.url,
      retrievedAt,
      markdown: `# ${candidate.title}\n\n${markdownBody}\n\n${metadata}\n`,
    };
  }

  private async discoverFeed(
    source: SourceDefinition,
    feed: string,
    signal?: AbortSignal,
  ): Promise<DailyReadingCandidate[]> {
    const response = await this.fetchAllowed(new URL(feed), source.allowedArticleHosts, {
      headers: { accept: "application/rss+xml,application/atom+xml,application/xml,text/xml" },
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) return [];
    const xml = await response.text();
    if (xml.length > 2_000_000) return [];
    const items = [...xml.matchAll(/<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)>/giu)];
    return items.slice(0, 20).flatMap((match, index) => {
      const item = match[1] ?? "";
      const title = tagValue(item, ["title"]);
      const rawLink = tagValue(item, ["link"])
        ?? /<link[^>]+href=["']([^"']+)["']/iu.exec(item)?.[1]
        ?? null;
      if (title === null || rawLink === null) return [];
      let url: URL;
      try { url = new URL(rawLink); } catch { return []; }
      if (url.protocol !== "https:" || !source.allowedArticleHosts.includes(url.hostname)) return [];
      return [{
        candidateId: `${source.sourceId}:${index}:${url.pathname}`,
        sourceId: source.sourceId,
        sourceVersion: source.sourceVersion,
        publisher: source.publisher,
        title,
        summary: tagValue(item, ["description", "summary", "content:encoded"])?.slice(0, 1_000) ?? "",
        url: url.toString(),
        publishedAt: safeIsoDate(tagValue(item, ["pubDate", "published", "updated", "dc:date"])),
        imageMode: source.imageMode,
        attribution: source.attribution,
      } satisfies DailyReadingCandidate];
    });
  }

  private async fetchAllowed(
    initialUrl: URL,
    allowedHosts: readonly string[],
    init: RequestInit,
  ): Promise<Response> {
    let url = initialUrl;
    for (let redirect = 0; redirect <= 4; redirect += 1) {
      if (url.protocol !== "https:" || !allowedHosts.includes(url.hostname)) {
        throw new Error("每日阅读来源重定向超出允许主机");
      }
      const response = await this.fetcher(url, { ...init, redirect: "manual" });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      if (location === null) return response;
      url = new URL(location, url);
    }
    throw new Error("每日阅读来源重定向次数过多");
  }
}
