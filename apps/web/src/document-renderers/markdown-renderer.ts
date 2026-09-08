import type { DocumentFormatDescriptor } from "@lumen/api-contract";
import { Brain, createElement, Highlighter, Languages } from "lucide";

import type {
  FormatRenderer,
  RendererHandle,
  RendererHighlight,
  RendererMountInput,
  SelectionCandidate,
} from "./renderer-contract";

function closestBlock(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return element?.closest<HTMLElement>("[data-block-id]") ?? null;
}

function textOffset(block: HTMLElement, node: Node, offset: number): number {
  const prefix = document.createRange();
  prefix.selectNodeContents(block);
  prefix.setEnd(node, offset);
  return prefix.toString().length;
}

export function readMarkdownSelection(root: HTMLElement): SelectionCandidate | null {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const startBlock = closestBlock(range.startContainer);
  const endBlock = closestBlock(range.endContainer);
  if (startBlock === null || endBlock === null) return null;
  const startBlockId = startBlock.dataset.blockId;
  const endBlockId = endBlock.dataset.blockId;
  if (startBlockId === undefined || endBlockId === undefined) return null;

  const startOffset = textOffset(startBlock, range.startContainer, range.startOffset);
  const endOffset = textOffset(endBlock, range.endContainer, range.endOffset);
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-block-id]"));
  const startIndex = blocks.indexOf(startBlock);
  const endIndex = blocks.indexOf(endBlock);
  if (startIndex < 0 || endIndex < startIndex) return null;
  const selectedText = blocks.slice(startIndex, endIndex + 1).map((block, index, selected) => {
    const text = block.textContent ?? "";
    return text.slice(index === 0 ? startOffset : 0, index === selected.length - 1 ? endOffset : text.length);
  }).join("\n\n");
  if (selectedText.trim().length === 0) return null;
  return {
    start: { blockId: startBlockId, offset: startOffset },
    end: { blockId: endBlockId, offset: endOffset },
    selectedText,
  };
}

function currentBlocks(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-block-id]"));
}

function publishViewportFacts(input: RendererMountInput, root: HTMLElement): void {
  const blocks = currentBlocks(root);
  if (blocks.length === 0) return;
  const viewportHeight = window.innerHeight;
  const visible = blocks.filter((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.bottom >= -80 && bounds.top <= viewportHeight + 80;
  });
  input.publish({
    type: "visibleRangeChanged",
    blockIds: visible.flatMap((element) => element.dataset.blockId ?? []),
  });

  const currentIndex = Math.max(
    0,
    blocks.findLastIndex((element) => element.getBoundingClientRect().top <= 140),
  );
  const blockId = blocks[currentIndex]?.dataset.blockId;
  if (blockId !== undefined) {
    input.publish({
      type: "readingPositionChanged",
      position: {
        blockId,
        offset: 0,
        progression: blocks.length === 1 ? 1 : currentIndex / (blocks.length - 1),
      },
    });
  }
}

function renderHighlights(
  root: HTMLElement,
  highlights: readonly RendererHighlight[],
  publish: RendererMountInput["publish"],
): void {
  root.querySelectorAll(".renderer-highlight-marker").forEach((element) => element.remove());
  root.querySelectorAll(".has-recall-match").forEach((element) => element.classList.remove("has-recall-match"));
  root.querySelectorAll(".renderer-text-highlight").forEach((element) => {
    const parent = element.parentNode;
    element.replaceWith(...element.childNodes);
    parent?.normalize();
  });
  for (const highlight of highlights) {
    if (
      (highlight.kind === "translation" || highlight.kind === "annotation")
      && highlight.range !== undefined
    ) {
      renderTextRange(root, highlight);
    }
  }
  for (const highlight of highlights) {
    const block = root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(highlight.blockId)}"]`);
    if (block === null) continue;
    if (highlight.kind === "recall") block.classList.add("has-recall-match");
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = `renderer-highlight-marker ${highlight.kind}-marker`;
    marker.setAttribute("aria-label", highlight.label);
    marker.title = highlight.label;
    const iconNode = highlight.kind === "recall"
      ? Brain
      : highlight.kind === "annotation"
        ? Highlighter
        : Languages;
    marker.append(createElement(iconNode, {
      "aria-hidden": "true",
      class: "app-icon",
      focusable: "false",
      height: 14,
      "stroke-width": 1.75,
      width: 14,
    }));
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      publish({ type: "highlightActivated", highlightId: highlight.highlightId });
    });
    block.append(marker);
  }
}

function renderTextRange(root: HTMLElement, highlight: RendererHighlight): void {
  if (highlight.range === undefined) return;
  const blocks = currentBlocks(root);
  const startIndex = blocks.findIndex((block) => block.dataset.blockId === highlight.range?.start.blockId);
  const endIndex = blocks.findIndex((block) => block.dataset.blockId === highlight.range?.end.blockId);
  if (startIndex < 0 || endIndex < startIndex) return;
  for (let index = startIndex; index <= endIndex; index += 1) {
    const block = blocks[index]!;
    const start = index === startIndex ? highlight.range.start.offset : 0;
    const end = index === endIndex
      ? highlight.range.end.offset
      : (block.textContent ?? "").length;
    wrapText(block, start, end, highlight.highlightId);
  }
}

function wrapText(block: HTMLElement, start: number, end: number, highlightId: string): void {
  if (end <= start) return;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const segments: Array<{ node: Text; start: number; end: number }> = [];
  let offset = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    const nextOffset = offset + text.data.length;
    const segmentStart = Math.max(start, offset);
    const segmentEnd = Math.min(end, nextOffset);
    if (segmentEnd > segmentStart) {
      segments.push({ node: text, start: segmentStart - offset, end: segmentEnd - offset });
    }
    offset = nextOffset;
  }
  for (const segment of segments.reverse()) {
    segment.node.splitText(segment.end);
    const selected = segment.node.splitText(segment.start);
    const mark = document.createElement("mark");
    mark.className = "translated-expression renderer-text-highlight";
    mark.dataset.highlightId = highlightId;
    selected.replaceWith(mark);
    mark.append(selected);
  }
}

export class MarkdownRenderer implements FormatRenderer {
  readonly formatId = "markdown";

  supports(descriptor: DocumentFormatDescriptor): boolean {
    return descriptor.formatId === this.formatId
      && descriptor.renderProjectionVersion.startsWith("markdown.render.");
  }

  mount(input: RendererMountInput): RendererHandle {
    const root = document.createElement("article");
    root.className = "format-renderer markdown-reader";
    root.dataset.formatRenderer = this.formatId;
    root.innerHTML = input.renderProjection;
    input.container.replaceChildren(root);

    const publishSelectionChanged = () => {
      input.publish({ type: "selectionChanged", candidate: readMarkdownSelection(root) });
    };
    const commitSelection = () => {
      const candidate = readMarkdownSelection(root);
      if (candidate === null) return;
      const selection = window.getSelection();
      const bounds = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
      input.publish({
        type: "selectionCommitted",
        candidate,
        bounds: bounds === null ? null : {
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
          left: bounds.left,
        },
      });
    };
    const activateLink = (event: Event) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a");
      if (link === null) return;
      event.preventDefault();
      input.publish({
        type: "linkActivated",
        label: link.textContent ?? "未命名链接",
        href: link.getAttribute("href"),
      });
    };
    let viewportTimer: number | undefined;
    const publishViewport = () => {
      window.clearTimeout(viewportTimer);
      viewportTimer = window.setTimeout(() => publishViewportFacts(input, root), 120);
    };

    document.addEventListener("selectionchange", publishSelectionChanged);
    root.addEventListener("mouseup", commitSelection);
    root.addEventListener("keyup", commitSelection);
    root.addEventListener("click", activateLink);
    window.addEventListener("scroll", publishViewport, { passive: true });
    window.addEventListener("resize", publishViewport);
    publishViewport();
    input.publish({ type: "contentReady" });

    return {
      navigateTo(blockId, behavior) {
        root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`)
          ?.scrollIntoView({ behavior, block: "start" });
      },
      setHighlights(highlights) {
        renderHighlights(root, highlights, input.publish);
      },
      clearSelection() {
        window.getSelection()?.removeAllRanges();
      },
      updatePreferences(preferences) {
        root.style.setProperty("--reader-content-width", `${preferences.readingWidth}px`);
        root.style.setProperty("--reader-font-size", `${preferences.readingFontSize}px`);
        root.style.setProperty("--reader-line-height", String(preferences.readingLineHeight));
      },
      dispose() {
        document.removeEventListener("selectionchange", publishSelectionChanged);
        root.removeEventListener("mouseup", commitSelection);
        root.removeEventListener("keyup", commitSelection);
        root.removeEventListener("click", activateLink);
        window.removeEventListener("scroll", publishViewport);
        window.removeEventListener("resize", publishViewport);
        window.clearTimeout(viewportTimer);
        root.remove();
      },
    };
  }
}
