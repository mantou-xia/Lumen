import type { DocumentFormatDescriptor } from "@lumen/api-contract";
import type {
  FormatRenderer,
  RendererHandle,
  RendererHighlight,
  RendererMountInput,
  RendererReferenceTarget,
  SelectionCandidate,
} from "./renderer-contract";

const referenceGutterWidth = 22;

interface TextRange {
  start: number;
  end: number;
}

export function continuousWordRange(anchor: TextRange, current: TextRange): TextRange {
  return {
    start: Math.min(anchor.start, current.start),
    end: Math.max(anchor.end, current.end),
  };
}

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

function trimmedRange(text: string, range: TextRange): TextRange | null {
  const start = trimLeadingWhitespace(text, range.start, range.end);
  const end = trimTrailingWhitespace(text, start, range.end);
  return end <= start ? null : { start, end };
}

export function referenceRangeForText(
  text: string,
  offset: number,
  kind: "word" | "sentence",
): TextRange | null {
  if (text.trim().length === 0) return null;
  const safeOffset = Math.min(text.length, Math.max(0, offset));
  const granularity = kind === "word" ? "word" : "sentence";
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("en", { granularity });
    const segments = Array.from(segmenter.segment(text));
    const segment = segments.find((candidate) => {
      const end = candidate.index + candidate.segment.length;
      return safeOffset >= candidate.index && safeOffset < end;
    }) ?? (safeOffset === text.length ? segments.at(-1) : undefined);
    if (segment !== undefined && (kind === "sentence" || segment.isWordLike === true)) {
      return trimmedRange(text, {
        start: segment.index,
        end: segment.index + segment.segment.length,
      });
    }
  }

  if (kind === "word") {
    const matches = Array.from(text.matchAll(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu));
    const match = matches.find((candidate) => {
      const start = candidate.index ?? 0;
      return safeOffset >= start && safeOffset < start + candidate[0].length;
    });
    return match === undefined ? null : {
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    };
  }

  let start = safeOffset;
  while (start > 0 && !/[.!?]/u.test(text[start - 1] ?? "")) start -= 1;
  let end = safeOffset;
  while (end < text.length && !/[.!?]/u.test(text[end] ?? "")) end += 1;
  if (end < text.length) end += 1;
  return trimmedRange(text, { start, end });
}

function textPositionAtOffset(block: HTMLElement, targetOffset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    const next = consumed + text.data.length;
    if (targetOffset <= next) return { node: text, offset: targetOffset - consumed };
    consumed = next;
  }
  return null;
}

function domRangeForTextRange(block: HTMLElement, range: TextRange): Range | null {
  const start = textPositionAtOffset(block, range.start);
  const end = textPositionAtOffset(block, range.end);
  if (start === null || end === null) return null;
  const domRange = document.createRange();
  domRange.setStart(start.node, start.offset);
  domRange.setEnd(end.node, end.offset);
  return domRange;
}

function rendererBounds(rect: DOMRect): RendererReferenceTarget["bounds"] {
  return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
}

export function mergeReferenceBounds(bounds: readonly RendererReferenceTarget["bounds"][]): RendererReferenceTarget["bounds"][] {
  const sorted = [...bounds]
    .filter((bound) => bound.right > bound.left && bound.bottom > bound.top)
    .sort((left, right) => left.top - right.top || left.left - right.left);
  const merged: RendererReferenceTarget["bounds"][] = [];
  for (const bound of sorted) {
    const current = merged.at(-1);
    const sharesLine = current !== undefined
      && Math.min(current.bottom, bound.bottom) > Math.max(current.top, bound.top);
    if (!sharesLine) {
      merged.push({ ...bound });
      continue;
    }
    current.top = Math.min(current.top, bound.top);
    current.right = Math.max(current.right, bound.right);
    current.bottom = Math.max(current.bottom, bound.bottom);
    current.left = Math.min(current.left, bound.left);
  }
  return merged;
}

function referenceGeometry(range: Range): Pick<RendererReferenceTarget, "bounds" | "previewBounds"> {
  return {
    bounds: rendererBounds(range.getBoundingClientRect()),
    previewBounds: mergeReferenceBounds(
      Array.from(range.getClientRects(), (rect) => rendererBounds(rect)),
    ),
  };
}

function caretAtPoint(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position !== null && position !== undefined) {
    return { node: position.offsetNode, offset: position.offset };
  }
  const range = doc.caretRangeFromPoint?.(x, y);
  return range === null || range === undefined
    ? null
    : { node: range.startContainer, offset: range.startOffset };
}

function pointTouchesCharacter(block: HTMLElement, offset: number, x: number, y: number): number | null {
  const text = block.textContent ?? "";
  for (const index of [offset, offset - 1]) {
    if (index < 0 || index >= text.length || /\s/u.test(text[index] ?? "")) continue;
    const range = domRangeForTextRange(block, { start: index, end: index + 1 });
    const rect = range?.getBoundingClientRect();
    if (rect !== undefined && x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 2 && y <= rect.bottom + 2) {
      return index;
    }
  }
  return null;
}

function blockAtPoint(root: HTMLElement, x: number, y: number): HTMLElement | null {
  const direct = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-block-id]");
  if (direct !== null && direct !== undefined && root.contains(direct)) return direct;
  return currentBlocks(root).find((block) => {
    const rect = block.getBoundingClientRect();
    return y >= rect.top && y <= rect.bottom
      && x >= rect.left - referenceGutterWidth
      && x <= rect.right + referenceGutterWidth;
  }) ?? null;
}

function referenceTargetAtPoint(
  root: HTMLElement,
  revisionId: string,
  x: number,
  y: number,
): RendererReferenceTarget | null {
  const block = blockAtPoint(root, x, y);
  const blockId = block?.dataset.blockId;
  if (block === null || blockId === undefined) return null;
  const text = block.textContent ?? "";
  if (text.trim().length === 0) return null;
  const blockRect = block.getBoundingClientRect();
  const isCodeBlock = block.matches("pre") || block.querySelector(":scope > pre") !== null;
  const inGutter = x <= blockRect.left + referenceGutterWidth
    || x >= blockRect.right - referenceGutterWidth;
  if (isCodeBlock || inGutter) {
    const range = trimmedRange(text, { start: 0, end: text.length });
    if (range === null) return null;
    const domRange = domRangeForTextRange(block, range);
    if (domRange === null) return null;
    return {
      revisionId,
      kind: "block",
      blockId,
      start: { blockId, offset: range.start },
      end: { blockId, offset: range.end },
      selectedText: text.slice(range.start, range.end),
      ...referenceGeometry(domRange),
    };
  }

  const caret = caretAtPoint(x, y);
  if (caret === null || !block.contains(caret.node)) return null;
  const semanticOffset = textOffset(block, caret.node, caret.offset);
  const characterOffset = pointTouchesCharacter(block, semanticOffset, x, y);
  const kind = characterOffset === null ? "sentence" : "word";
  const range = referenceRangeForText(text, characterOffset ?? semanticOffset, kind);
  if (range === null) return null;
  const domRange = domRangeForTextRange(block, range);
  if (domRange === null) return null;
  return {
    revisionId,
    kind,
    blockId,
    start: { blockId, offset: range.start },
    end: { blockId, offset: range.end },
    selectedText: text.slice(range.start, range.end),
    ...referenceGeometry(domRange),
  };
}

function wordSpanReferenceTarget(
  root: HTMLElement,
  revisionId: string,
  anchor: RendererReferenceTarget,
  current: RendererReferenceTarget,
): RendererReferenceTarget | null {
  if (anchor.kind !== "word" || current.kind !== "word" || anchor.blockId !== current.blockId) {
    return null;
  }
  const block = root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(anchor.blockId)}"]`);
  if (block === null) return null;
  const text = block.textContent ?? "";
  const range = continuousWordRange(
    { start: anchor.start.offset, end: anchor.end.offset },
    { start: current.start.offset, end: current.end.offset },
  );
  const domRange = domRangeForTextRange(block, range);
  if (domRange === null) return null;
  return {
    revisionId,
    kind: range.start === anchor.start.offset && range.end === anchor.end.offset ? "word" : "phrase",
    blockId: anchor.blockId,
    start: { blockId: anchor.blockId, offset: range.start },
    end: { blockId: anchor.blockId, offset: range.end },
    selectedText: text.slice(range.start, range.end),
    ...referenceGeometry(domRange),
  };
}

function showReferencePreview(layer: HTMLElement, target: RendererReferenceTarget | null): void {
  layer.replaceChildren();
  if (target === null) return;
  for (const bounds of target.previewBounds) {
    const marker = document.createElement("div");
    marker.className = `reference-preview reference-preview--${target.kind}`;
    marker.style.left = `${bounds.left}px`;
    marker.style.top = `${bounds.top}px`;
    marker.style.width = `${Math.max(1, bounds.right - bounds.left)}px`;
    marker.style.height = `${Math.max(1, bounds.bottom - bounds.top)}px`;
    layer.append(marker);
  }
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

export function applyMarkdownScrollAreas(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>("pre, .reader-table-scroll").forEach((element) => {
    element.classList.add("ui-scroll-area", "ui-scroll-area--x");
  });
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
  const currentBlock = blocks[currentIndex];
  if (currentBlock === undefined) return;
  const blockId = currentBlock?.dataset.blockId;
  if (blockId !== undefined) {
    const currentBounds = currentBlock.getBoundingClientRect();
    const nextBounds = blocks[currentIndex + 1]?.getBoundingClientRect();
    const sectionHeight = Math.max(
      1,
      nextBounds === undefined ? currentBounds.height : nextBounds.top - currentBounds.top,
    );
    const sectionProgress = Math.min(1, Math.max(0, (140 - currentBounds.top) / sectionHeight));
    input.publish({
      type: "readingPositionChanged",
      position: {
        blockId,
        offset: 0,
        progression: blocks.length === 1
          ? sectionProgress
          : Math.min(1, (currentIndex + sectionProgress) / (blocks.length - 1)),
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
    wrapText(block, start, end, highlight, publish, index === endIndex);
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
  isRangeEnd: boolean,
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
  const lastSegment = segments.at(-1);
  for (const segment of [...segments].reverse()) {
    segment.node.splitText(segment.end);
    const selected = segment.node.splitText(segment.start);
    const mark = document.createElement("mark");
    mark.className = highlightClassName(
      highlight.kind,
      isRangeEnd && segment === lastSegment,
    );
    mark.dataset.highlightId = highlight.highlightId;
    if (highlight.kind === "reference") {
      mark.setAttribute("aria-hidden", "true");
    } else {
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
    }
    selected.replaceWith(mark);
    mark.append(selected);
  }
}

export function highlightClassName(
  kind: RendererHighlight["kind"],
  isRangeTail: boolean,
): string {
  return [
    "renderer-text-highlight",
    `${kind}-text-highlight`,
    kind === "footnote" && isRangeTail ? "footnote-tail-marker" : "",
  ].filter(Boolean).join(" ");
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
    applyMarkdownScrollAreas(root);
    input.container.replaceChildren(root);
    const previewLayer = document.createElement("div");
    previewLayer.className = "reference-preview-layer";
    previewLayer.setAttribute("aria-hidden", "true");
    document.body.append(previewLayer);
    let referenceMode = false;
    let activeReferenceTarget: RendererReferenceTarget | null = null;
    let referencePointer: { pointerId: number; anchor: RendererReferenceTarget } | null = null;

    const updateReferenceTarget = (target: RendererReferenceTarget | null) => {
      activeReferenceTarget = target;
      showReferencePreview(previewLayer, target);
      input.publish({ type: "referenceTargetChanged", target });
    };

    const publishSelectionChanged = () => {
      input.publish({ type: "selectionChanged", candidate: readMarkdownSelection(root) });
    };
    const commitSelection = () => {
      if (referenceMode) return;
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
      if (referenceMode) {
        event.preventDefault();
        return;
      }
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a");
      if (link === null) return;
      event.preventDefault();
      input.publish({
        type: "linkActivated",
        label: link.textContent ?? "未命名链接",
        href: link.getAttribute("href"),
      });
    };
    const previewReferenceTarget = (event: PointerEvent) => {
      if (!referenceMode) return;
      const target = referenceTargetAtPoint(root, input.revisionId, event.clientX, event.clientY);
      if (referencePointer !== null && event.pointerId === referencePointer.pointerId) {
        if (target?.kind !== "word") return;
        const span = wordSpanReferenceTarget(root, input.revisionId, referencePointer.anchor, target);
        if (span !== null) updateReferenceTarget(span);
        return;
      }
      updateReferenceTarget(target);
    };
    const clearReferenceTarget = () => {
      if (!referenceMode || referencePointer !== null || activeReferenceTarget === null) return;
      activeReferenceTarget = null;
      showReferencePreview(previewLayer, null);
      input.publish({ type: "referenceTargetCleared" });
    };
    const startReferenceTarget = (event: PointerEvent) => {
      if (!referenceMode || event.button !== 0) return;
      const target = referenceTargetAtPoint(root, input.revisionId, event.clientX, event.clientY);
      if (target === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      referencePointer = { pointerId: event.pointerId, anchor: target };
      root.setPointerCapture(event.pointerId);
      updateReferenceTarget(target);
    };
    const commitReferenceTarget = (event: PointerEvent) => {
      if (!referenceMode || referencePointer?.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
      referencePointer = null;
      if (activeReferenceTarget === null) return;
      input.publish({ type: "referenceTargetCommitted", target: activeReferenceTarget });
    };
    const cancelReferenceTarget = (event: PointerEvent) => {
      if (referencePointer?.pointerId !== event.pointerId) return;
      referencePointer = null;
      clearReferenceTarget();
    };
    const requestReferenceExit = (event: MouseEvent) => {
      if (!referenceMode) return;
      event.preventDefault();
      input.publish({ type: "referenceModeExitRequested" });
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
    root.addEventListener("pointerdown", startReferenceTarget, true);
    root.addEventListener("pointermove", previewReferenceTarget);
    root.addEventListener("pointerup", commitReferenceTarget, true);
    root.addEventListener("pointercancel", cancelReferenceTarget, true);
    root.addEventListener("pointerleave", clearReferenceTarget);
    root.addEventListener("contextmenu", requestReferenceExit);
    window.addEventListener("scroll", publishViewport, { passive: true });
    window.addEventListener("resize", publishViewport);
    publishViewport();
    input.publish({ type: "contentReady" });

    return {
      referenceCapabilities: {
        supported: true,
        granularities: ["word", "phrase", "sentence", "block"],
        hoverPreview: true,
        sideGutterTargeting: true,
        sourceMapping: true,
      },
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
      enterReferenceMode() {
        referenceMode = true;
        root.classList.add("is-reference-mode");
        window.getSelection()?.removeAllRanges();
      },
      exitReferenceMode() {
        referenceMode = false;
        referencePointer = null;
        activeReferenceTarget = null;
        root.classList.remove("is-reference-mode");
        showReferencePreview(previewLayer, null);
        input.publish({ type: "referenceTargetCleared" });
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
        root.removeEventListener("pointerdown", startReferenceTarget, true);
        root.removeEventListener("pointermove", previewReferenceTarget);
        root.removeEventListener("pointerup", commitReferenceTarget, true);
        root.removeEventListener("pointercancel", cancelReferenceTarget, true);
        root.removeEventListener("pointerleave", clearReferenceTarget);
        root.removeEventListener("contextmenu", requestReferenceExit);
        window.removeEventListener("scroll", publishViewport);
        window.removeEventListener("resize", publishViewport);
        window.clearTimeout(viewportTimer);
        previewLayer.remove();
        root.remove();
      },
    };
  }
}
