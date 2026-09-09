import type { DocumentFormatDescriptor } from "@lumen/api-contract";
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
  const selectedParts = blocks.slice(startIndex, endIndex + 1).map((block, index, selected) => {
    const text = block.textContent ?? "";
    const partStart = index === 0 ? startOffset : 0;
    const partEnd = index === selected.length - 1 ? endOffset : text.length;
    return {
      blockId: block.dataset.blockId!,
      start: partStart,
      end: partEnd,
      text: text.slice(partStart, partEnd),
    };
  });
  return normalizeSelectionParts(selectedParts);
}

export function normalizeSelectionParts(parts: readonly {
  blockId: string;
  start: number;
  end: number;
  text: string;
}[]): SelectionCandidate | null {
  const firstContentIndex = parts.findIndex((part) => /\S/u.test(part.text));
  const lastContentIndex = parts.findLastIndex((part) => /\S/u.test(part.text));
  if (firstContentIndex < 0 || lastContentIndex < firstContentIndex) return null;
  const visibleParts = parts.slice(firstContentIndex, lastContentIndex + 1);
  const firstPart = visibleParts[0]!;
  const lastPart = visibleParts[visibleParts.length - 1]!;
  const leadingWhitespace = trimLeadingWhitespace(firstPart.text, 0, firstPart.text.length);
  const trailingEnd = trimTrailingWhitespace(lastPart.text, 0, lastPart.text.length);
  const selectedText = visibleParts.map((part, index) => {
    const start = index === 0 ? leadingWhitespace : 0;
    const end = index === visibleParts.length - 1 ? trailingEnd : part.text.length;
    return part.text.slice(start, end);
  }).join("\n\n");
  return {
    start: { blockId: firstPart.blockId, offset: firstPart.start + leadingWhitespace },
    end: { blockId: lastPart.blockId, offset: lastPart.start + trailingEnd },
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
  root.querySelectorAll(".renderer-text-highlight").forEach((element) => {
    const parent = element.parentNode;
    element.replaceWith(...element.childNodes);
    parent?.normalize();
  });
  for (const highlight of highlights) {
    if (highlight.range !== undefined) renderTextRange(root, highlight, publish);
  }
}

function renderTextRange(
  root: HTMLElement,
  highlight: RendererHighlight,
  publish: RendererMountInput["publish"],
): void {
  if (highlight.range === undefined) return;
  const blocks = currentBlocks(root);
  const startIndex = blocks.findIndex((block) => block.dataset.blockId === highlight.range?.start.blockId);
  const endIndex = blocks.findIndex((block) => block.dataset.blockId === highlight.range?.end.blockId);
  if (startIndex < 0 || endIndex < startIndex) return;
  const visualRange = highlight.kind === "translation"
    ? trimTranslationRange(blocks, startIndex, endIndex, highlight.range)
    : highlight.range;
  for (let index = startIndex; index <= endIndex; index += 1) {
    const block = blocks[index]!;
    const start = index === startIndex ? visualRange.start.offset : 0;
    const end = index === endIndex
      ? visualRange.end.offset
      : (block.textContent ?? "").length;
    wrapText(block, start, end, highlight, publish);
  }
}

function trimTranslationRange(
  blocks: readonly HTMLElement[],
  startIndex: number,
  endIndex: number,
  range: NonNullable<RendererHighlight["range"]>,
): NonNullable<RendererHighlight["range"]> {
  const startText = blocks[startIndex]?.textContent ?? "";
  const endText = blocks[endIndex]?.textContent ?? "";
  const sameBlock = startIndex === endIndex;
  const startLimit = sameBlock ? range.end.offset : startText.length;
  const endLimit = sameBlock ? range.start.offset : 0;
  return {
    start: {
      ...range.start,
      offset: trimLeadingWhitespace(startText, range.start.offset, startLimit),
    },
    end: {
      ...range.end,
      offset: trimTrailingWhitespace(endText, endLimit, range.end.offset),
    },
  };
}

export function trimLeadingWhitespace(text: string, start: number, end: number): number {
  let offset = start;
  while (offset < end && /\s/u.test(text[offset] ?? "")) offset += 1;
  return offset;
}

export function trimTrailingWhitespace(text: string, start: number, end: number): number {
  let offset = end;
  while (offset > start && /\s/u.test(text[offset - 1] ?? "")) offset -= 1;
  return offset;
}

function wrapText(
  block: HTMLElement,
  start: number,
  end: number,
  highlight: RendererHighlight,
  publish: RendererMountInput["publish"],
): void {
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
    mark.className = `renderer-text-highlight ${highlight.kind}-text-highlight`;
    mark.dataset.highlightId = highlight.highlightId;
    mark.tabIndex = 0;
    mark.setAttribute("role", "button");
    mark.setAttribute("aria-label", highlight.label);
    mark.title = highlight.label;
    const activate = (event: Event) => {
      event.stopPropagation();
      const bounds = mark.getBoundingClientRect();
      publish({
        type: "highlightActivated",
        highlightId: highlight.highlightId,
        bounds: {
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
          left: bounds.left,
        },
      });
    };
    mark.addEventListener("click", activate);
    mark.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activate(event);
    });
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
