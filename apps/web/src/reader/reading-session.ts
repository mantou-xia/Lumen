import type { RendererBounds, SelectionCandidate } from "../document-renderers/renderer-contract";

export interface PendingSelectionIdentity {
  readerInstanceId: string;
  revisionId: string;
  sequence: number;
  candidate: SelectionCandidate;
  bounds: RendererBounds | null;
}

export function createReaderInstanceId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `reader-${Date.now()}-${Math.random()}`;
}

export function sameSelectionCandidate(
  left: SelectionCandidate,
  right: SelectionCandidate,
): boolean {
  return left.start.blockId === right.start.blockId
    && left.start.offset === right.start.offset
    && left.end.blockId === right.end.blockId
    && left.end.offset === right.end.offset
    && left.selectedText === right.selectedText;
}
