import type { DocumentFormatDescriptor, SemanticPoint } from "@lumen/api-contract";

import type { UiPreferences } from "../app/preferences";

export interface SelectionCandidate {
  start: SemanticPoint;
  end: SemanticPoint;
  selectedText: string;
}

export interface RendererBounds {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface RendererReadingPosition {
  blockId: string;
  offset: number;
  progression: number;
}

export type ReferenceGranularity = "word" | "sentence" | "block";

export interface RendererReferenceCapabilities {
  supported: boolean;
  granularities: ReferenceGranularity[];
  hoverPreview: boolean;
  sideGutterTargeting: boolean;
  sourceMapping: boolean;
}

export interface RendererReferenceTarget extends SelectionCandidate {
  kind: ReferenceGranularity;
  blockId: string;
  bounds: RendererBounds;
}

export interface RendererHighlight {
  highlightId: string;
  blockId: string;
  label: string;
  kind: "recall" | "translation" | "annotation";
  range?: { start: SemanticPoint; end: SemanticPoint };
}

export type RendererEvent =
  | { type: "contentReady" }
  | { type: "selectionChanged"; candidate: SelectionCandidate | null }
  | { type: "selectionCommitted"; candidate: SelectionCandidate; bounds: RendererBounds | null }
  | { type: "visibleRangeChanged"; blockIds: string[] }
  | { type: "readingPositionChanged"; position: RendererReadingPosition }
  | { type: "linkActivated"; label: string; href: string | null }
  | { type: "highlightActivated"; highlightId: string; bounds: RendererBounds }
  | { type: "referenceTargetChanged"; target: RendererReferenceTarget | null }
  | { type: "referenceTargetCommitted"; target: RendererReferenceTarget }
  | { type: "referenceTargetCleared" }
  | { type: "referenceModeExitRequested" }
  | { type: "renderFailed"; message: string };

export interface RendererMountInput {
  container: HTMLElement;
  descriptor: DocumentFormatDescriptor;
  revisionId: string;
  renderProjection: string;
  preferences: UiPreferences;
  publish(event: RendererEvent): void;
}

export interface RendererHandle {
  readonly referenceCapabilities: RendererReferenceCapabilities;
  navigateTo(blockId: string, behavior: ScrollBehavior): void;
  setHighlights(highlights: readonly RendererHighlight[]): void;
  clearSelection(): void;
  enterReferenceMode(): void;
  exitReferenceMode(): void;
  updatePreferences(preferences: UiPreferences): void;
  dispose(): void;
}

export interface FormatRenderer {
  readonly formatId: string;
  supports(descriptor: DocumentFormatDescriptor): boolean;
  mount(input: RendererMountInput): RendererHandle;
}
