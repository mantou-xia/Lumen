import { Fragment, type ReactNode } from "react";
import type { ConversationReference, WorkspaceReference } from "@lumen/api-contract";

import { Button } from "../app/ui";

export function SafeMarkdown({
  content,
  references = [],
  onReference,
}: {
  content: string;
  references?: readonly MarkdownReference[];
  onReference?(reference: MarkdownReference): void;
}) {
  const referenceById = new Map(references.map((reference) => [reference.referenceId, reference]));
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
      blocks.push(<ul key={`ul-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item, referenceById, onReference)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/u.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/u.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*\d+[.)]\s+/u, ""));
        index += 1;
      }
      blocks.push(<ol key={`ol-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item, referenceById, onReference)}</li>)}</ol>);
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
    blocks.push(<p key={`p-${index}`}>{inline(paragraph.join(" "), referenceById, onReference)}</p>);
  }
  return <div className="safe-markdown">{blocks}</div>;
}

type MarkdownReference = WorkspaceReference | ConversationReference;

function inline(
  value: string,
  referenceById: ReadonlyMap<string, MarkdownReference>,
  onReference: ((reference: MarkdownReference) => void) | undefined,
): ReactNode[] {
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
      const reference = workspaceReferenceFromHref(href, referenceById);
      if (reference !== null && onReference !== undefined) {
        nodes.push(
          <Button
            className="safe-markdown-reference"
            key={key}
            type="button"
            variant="ghost"
            onClick={() => onReference(reference)}
          >{parts?.[1]}</Button>,
        );
      } else {
        nodes.push(isSafeHref(href)
          ? <a href={href} key={key} rel="noreferrer" target="_blank">{parts?.[1]}</a>
          : <Fragment key={key}>{parts?.[1] ?? token}</Fragment>);
      }
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

function workspaceReferenceFromHref(
  href: string,
  referenceById: ReadonlyMap<string, MarkdownReference>,
): MarkdownReference | null {
  const prefix = "lumen-reference:";
  if (!href.startsWith(prefix)) return null;
  const referenceId = href.slice(prefix.length);
  return referenceById.get(referenceId) ?? null;
}

function isSafeHref(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
