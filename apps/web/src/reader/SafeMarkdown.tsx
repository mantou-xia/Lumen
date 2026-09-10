import { Fragment, type ReactNode } from "react";

export function SafeMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<pre key={`code-${index}`}><code data-language={language || undefined}>{code.join("\n")}</code></pre>);
      continue;
    }
    if (/^\s*[-*]\s+/u.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/u.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*[-*]\s+/u, ""));
        index += 1;
      }
      blocks.push(<ul key={`ul-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/u.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/u.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*\d+[.)]\s+/u, ""));
        index += 1;
      }
      blocks.push(<ol key={`ol-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</ol>);
      continue;
    }
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length
      && (lines[index] ?? "").trim().length > 0
      && !(lines[index] ?? "").startsWith("```")
      && !/^\s*(?:[-*]|\d+[.)])\s+/u.test(lines[index] ?? "")
    ) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push(<p key={`p-${index}`}>{inline(paragraph.join(" "))}</p>);
  }
  return <div className="safe-markdown">{blocks}</div>;
}

function inline(value: string): ReactNode[] {
  const pattern = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/gu;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(value.slice(cursor, start));
    const token = match[0];
    const key = `${start}-${token.length}`;
    if (token.startsWith("[")) {
      const parts = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(token);
      const href = parts?.[2] ?? "";
      nodes.push(isSafeHref(href)
        ? <a href={href} key={key} rel="noreferrer" target="_blank">{parts?.[1]}</a>
        : <Fragment key={key}>{parts?.[1] ?? token}</Fragment>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    cursor = start + token.length;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function isSafeHref(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
