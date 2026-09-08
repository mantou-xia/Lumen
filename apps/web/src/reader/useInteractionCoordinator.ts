import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Annotation,
  ReaderDocument,
  RecallMatch,
  RecallOccurrence,
  TranslationRangeSummary,
  TranslationResult,
  UpdateReadingProgressRequest,
} from "@lumen/api-contract";
import type { SelectionCandidate } from "../document-renderers/renderer-contract";

import { getAnnotations } from "../api/annotation";
import { getRecallMatches, openRecallOccurrence } from "../api/recall";
import { saveReadingProgress } from "../api/reader";
import {
  getTranslationRanges,
  getTranslationResult,
  retryTranslation,
  translateSelection,
} from "../api/translation";
import type { UiPreferences } from "../app/preferences";
import type {
  RendererEvent,
  RendererBounds,
  RendererHandle,
} from "../document-renderers/renderer-contract";
import {
  createReaderInstanceId,
  sameSelectionCandidate,
  type PendingSelectionIdentity,
} from "./reading-session";

function recallHighlightId(match: RecallMatch): string {
  return ["recall", match.expressionId, match.blockId, match.startOffset, match.endOffset].join(":");
}

function translationHighlightId(summary: TranslationRangeSummary): string {
  return `translation:${summary.translationId}`;
}

function summaryFromResult(result: TranslationResult): TranslationRangeSummary {
  return {
    translationId: result.translationId,
    operationId: result.operationId,
    revisionId: result.selection.revisionId,
    start: result.selection.start,
    end: result.selection.end,
    selectedText: result.selection.selectedText,
    fingerprint: result.selection.fingerprint,
    createdAt: result.createdAt,
  };
}

function upsertSummary(
  summaries: TranslationRangeSummary[],
  result: TranslationResult,
): TranslationRangeSummary[] {
  return [
    ...summaries.filter((summary) => summary.translationId !== result.translationId),
    summaryFromResult(result),
  ];
}

export function useInteractionCoordinator(input: {
  documentId: string;
  reader: ReaderDocument;
  requestedBlockId: string | null;
  requestedRange: {
    start: { blockId: string; offset: number };
    end: { blockId: string; offset: number };
  } | null;
  preferences: UiPreferences;
  openTranslationOverlay(): void;
  openRecallOverlay(): void;
  openAnnotationOverlay(): void;
}) {
  const {
    documentId,
    openAnnotationOverlay,
    openRecallOverlay,
    openTranslationOverlay,
    preferences,
    reader,
    requestedBlockId,
    requestedRange,
  } = input;
  const [rendererHandle, setRendererHandle] = useState<RendererHandle | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [translation, setTranslation] = useState<TranslationResult | null>(null);
  const [translationStatus, setTranslationStatus] = useState<"idle" | "loading" | "error">("idle");
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [translationRanges, setTranslationRanges] = useState<TranslationRangeSummary[]>([]);
  const [activeSelectionText, setActiveSelectionText] = useState<string | null>(null);
  const [workspaceSelection, setWorkspaceSelection] = useState<SelectionCandidate | null>(null);
  const [visibleBlockIds, setVisibleBlockIds] = useState<string[]>([]);
  const [translationAnchor, setTranslationAnchor] = useState<{
    bounds: RendererBounds;
    scrollX: number;
    scrollY: number;
  } | null>(null);
  const [recallMatches, setRecallMatches] = useState<RecallMatch[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeAnnotation, setActiveAnnotation] = useState<Annotation | null>(null);
  const [activeRecall, setActiveRecall] = useState<RecallOccurrence | null>(null);
  const [recallStatus, setRecallStatus] = useState<"idle" | "opening" | "error">("idle");
  const [recallError, setRecallError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const readerInstanceIdRef = useRef(createReaderInstanceId());
  const sequenceRef = useRef(0);
  const pendingSelectionRef = useRef<PendingSelectionIdentity | null>(null);
  const translationAbortRef = useRef<AbortController | null>(null);
  const progressTimerRef = useRef<number | undefined>(undefined);
  const lastProgressRef = useRef<UpdateReadingProgressRequest | null>(null);
  const recallRequestRef = useRef(0);
  const translationRangeRequestRef = useRef(0);
  const annotationRequestRef = useRef(0);
  const canPersistProgress = reader.revision.revisionId === reader.document.activeRevisionId;

  const flushProgress = useCallback(() => {
    window.clearTimeout(progressTimerRef.current);
    const latest = lastProgressRef.current;
    if (canPersistProgress && latest !== null) {
      void saveReadingProgress(documentId, latest).catch(() => undefined);
    }
  }, [canPersistProgress, documentId]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushProgress();
    };
    window.addEventListener("pagehide", flushProgress);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      flushProgress();
      window.removeEventListener("pagehide", flushProgress);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      translationAbortRef.current?.abort();
    };
  }, [flushProgress]);

  useEffect(() => {
    if (rendererHandle === null) return;
    const restoredBlockId = requestedBlockId ?? (
      reader.progress?.revisionId === reader.revision.revisionId
        ? reader.progress.blockId
        : null
    );
    if (restoredBlockId !== null) {
      requestAnimationFrame(() => rendererHandle.navigateTo(restoredBlockId, "auto"));
    }
  }, [reader, requestedBlockId, rendererHandle]);

  useEffect(() => {
    const firstMatchByBlock = new Map<string, RecallMatch>();
    for (const match of recallMatches) {
      if (!firstMatchByBlock.has(match.blockId)) firstMatchByBlock.set(match.blockId, match);
    }
    rendererHandle?.setHighlights([
      ...(requestedRange === null ? [] : [{
        highlightId: "source-location",
        blockId: requestedRange.start.blockId,
        label: "学习语境原文位置",
        kind: "annotation" as const,
        range: requestedRange,
      }]),
      ...annotations.map((annotation) => ({
        highlightId: `annotation:${annotation.annotationId}`,
        blockId: annotation.start.blockId,
        label: `标注：${annotation.selectedText}`,
        kind: "annotation" as const,
        range: { start: annotation.start, end: annotation.end },
      })),
      ...translationRanges.map((summary) => ({
        highlightId: translationHighlightId(summary),
        blockId: summary.start.blockId,
        label: `已翻译：${summary.selectedText}`,
        kind: "translation" as const,
        range: { start: summary.start, end: summary.end },
      })),
      ...[...firstMatchByBlock.values()].map((match) => ({
        highlightId: recallHighlightId(match),
        blockId: match.blockId,
        label: `回忆表达：${match.surfaceForm}`,
        kind: "recall" as const,
      })),
    ]);
  }, [annotations, recallMatches, rendererHandle, requestedRange, translationRanges]);

  const translateCandidate = useCallback(async (
    event: Extract<RendererEvent, { type: "selectionCommitted" }>,
  ) => {
    if (!preferences.autoTranslateSelection) return;
    setActiveSelectionText(event.candidate.selectedText);
    setTranslationAnchor(event.bounds === null ? null : {
      bounds: event.bounds,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    });
    sequenceRef.current += 1;
    const identity: PendingSelectionIdentity = {
      readerInstanceId: readerInstanceIdRef.current,
      revisionId: reader.revision.revisionId,
      sequence: sequenceRef.current,
      candidate: event.candidate,
      bounds: event.bounds,
    };
    pendingSelectionRef.current = identity;
    translationAbortRef.current?.abort();
    const controller = new AbortController();
    translationAbortRef.current = controller;
    setTranslation(null);
    setTranslationError(null);
    setTranslationStatus("loading");
    openTranslationOverlay();
    try {
      const result = await translateSelection(
        documentId,
        { revisionId: identity.revisionId, ...identity.candidate },
        controller.signal,
      );
      const current = pendingSelectionRef.current;
      if (
        current !== null
        && current.readerInstanceId === identity.readerInstanceId
        && current.revisionId === result.selection.revisionId
        && current.sequence === identity.sequence
        && sameSelectionCandidate(current.candidate, result.selection)
      ) {
        setTranslation(result);
        setTranslationRanges((ranges) => upsertSummary(ranges, result));
        setTranslationStatus("idle");
      }
    } catch (reason) {
      if (!controller.signal.aborted && pendingSelectionRef.current?.sequence === identity.sequence) {
        setTranslationError(reason instanceof Error ? reason.message : "翻译失败");
        setTranslationStatus("error");
      }
    }
  }, [documentId, openTranslationOverlay, preferences.autoTranslateSelection, reader.revision.revisionId]);

  const queryRecallMatches = useCallback((blockIds: string[]) => {
    if (!canPersistProgress || !preferences.recallEnabled || blockIds.length === 0) {
      setRecallMatches([]);
      return;
    }
    recallRequestRef.current += 1;
    const requestId = recallRequestRef.current;
    const revisionId = reader.revision.revisionId;
    void getRecallMatches(documentId, revisionId, blockIds)
      .then((matches) => {
        if (recallRequestRef.current === requestId && reader.revision.revisionId === revisionId) {
          setRecallMatches(matches);
        }
      })
      .catch((reason: unknown) => {
        if (recallRequestRef.current === requestId) {
          setRecallError(reason instanceof Error ? reason.message : "Recall 匹配失败");
        }
      });
  }, [canPersistProgress, documentId, preferences.recallEnabled, reader.revision.revisionId]);

  const queryTranslationRanges = useCallback((blockIds: string[]) => {
    if (blockIds.length === 0) {
      setTranslationRanges([]);
      return;
    }
    translationRangeRequestRef.current += 1;
    const requestId = translationRangeRequestRef.current;
    const revisionId = reader.revision.revisionId;
    void getTranslationRanges(documentId, revisionId, blockIds)
      .then((ranges) => {
        if (
          translationRangeRequestRef.current === requestId
          && reader.revision.revisionId === revisionId
        ) {
          setTranslationRanges(ranges);
        }
      })
      .catch(() => undefined);
  }, [documentId, reader.revision.revisionId]);

  const queryAnnotations = useCallback((blockIds: string[]) => {
    if (blockIds.length === 0) {
      setAnnotations([]);
      return;
    }
    annotationRequestRef.current += 1;
    const requestId = annotationRequestRef.current;
    const revisionId = reader.revision.revisionId;
    void getAnnotations(documentId, revisionId, blockIds)
      .then((items) => {
        if (annotationRequestRef.current === requestId && reader.revision.revisionId === revisionId) {
          setAnnotations(items);
        }
      })
      .catch(() => undefined);
  }, [documentId, reader.revision.revisionId]);

  const openHistoricalTranslation = useCallback((highlightId: string) => {
    const summary = translationRanges.find(
      (item) => translationHighlightId(item) === highlightId,
    );
    if (summary === undefined) return;
    sequenceRef.current += 1;
    const sequence = sequenceRef.current;
    const readerInstanceId = readerInstanceIdRef.current;
    translationAbortRef.current?.abort();
    const controller = new AbortController();
    translationAbortRef.current = controller;
    pendingSelectionRef.current = null;
    setActiveSelectionText(summary.selectedText);
    setTranslationAnchor(null);
    setTranslation(null);
    setTranslationError(null);
    setTranslationStatus("loading");
    openTranslationOverlay();
    void getTranslationResult(summary.translationId, controller.signal)
      .then((result) => {
        if (
          readerInstanceIdRef.current === readerInstanceId
          && sequenceRef.current === sequence
          && result.translationId === summary.translationId
          && result.operationId === summary.operationId
          && result.selection.revisionId === reader.revision.revisionId
          && result.selection.fingerprint === summary.fingerprint
        ) {
          setTranslation(result);
          setTranslationStatus("idle");
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && sequenceRef.current === sequence) {
          setTranslationError(reason instanceof Error ? reason.message : "无法读取历史翻译");
          setTranslationStatus("error");
        }
      });
  }, [openTranslationOverlay, reader.revision.revisionId, translationRanges]);

  const openRecall = useCallback((highlightId: string) => {
    const match = recallMatches.find((item) => recallHighlightId(item) === highlightId);
    if (match === undefined) return;
    setRecallStatus("opening");
    setRecallError(null);
    openRecallOverlay();
    void openRecallOccurrence(reader.revision.revisionId, match)
      .then((occurrence) => {
        setActiveRecall(occurrence);
        setRecallStatus("idle");
      })
      .catch((reason: unknown) => {
        setRecallError(reason instanceof Error ? reason.message : "无法打开 Recall");
        setRecallStatus("error");
      });
  }, [openRecallOverlay, reader.revision.revisionId, recallMatches]);

  const handleRendererEvent = useCallback((event: RendererEvent) => {
    if (event.type === "selectionCommitted") {
      setWorkspaceSelection(event.candidate);
      void translateCandidate(event);
    }
    else if (event.type === "visibleRangeChanged") {
      setVisibleBlockIds(event.blockIds);
      queryRecallMatches(event.blockIds);
      queryTranslationRanges(event.blockIds);
      queryAnnotations(event.blockIds);
    }
    else if (event.type === "readingPositionChanged") {
      if (!canPersistProgress) return;
      const progress = { revisionId: reader.revision.revisionId, ...event.position };
      lastProgressRef.current = progress;
      window.clearTimeout(progressTimerRef.current);
      progressTimerRef.current = window.setTimeout(() => {
        void saveReadingProgress(documentId, progress).catch(() => undefined);
      }, 500);
    } else if (event.type === "linkActivated") {
      setLinkNotice(`文档外部链接已阻止自动打开：${event.label}`);
    } else if (event.type === "highlightActivated") {
      if (event.highlightId.startsWith("translation:")) openHistoricalTranslation(event.highlightId);
      else if (event.highlightId.startsWith("annotation:")) {
        const annotation = annotations.find(
          (item) => `annotation:${item.annotationId}` === event.highlightId,
        );
        if (annotation !== undefined) {
          setActiveAnnotation(annotation);
          openAnnotationOverlay();
        }
      }
      else if (event.highlightId === "source-location") {
        setLinkNotice("这里是表达档案中保存的原文范围。");
      }
      else openRecall(event.highlightId);
    }
    else if (event.type === "renderFailed") setRenderError(event.message);
  }, [
    canPersistProgress,
    documentId,
    openHistoricalTranslation,
    openAnnotationOverlay,
    openRecall,
    annotations,
    queryAnnotations,
    queryRecallMatches,
    queryTranslationRanges,
    reader.revision.revisionId,
    translateCandidate,
  ]);

  const retryActiveTranslation = useCallback(() => {
    if (translation === null) return;
    const previous = translation;
    sequenceRef.current += 1;
    const sequence = sequenceRef.current;
    const readerInstanceId = readerInstanceIdRef.current;
    translationAbortRef.current?.abort();
    const controller = new AbortController();
    translationAbortRef.current = controller;
    setTranslationError(null);
    setTranslationStatus("loading");
    void retryTranslation(previous.translationId, controller.signal)
      .then((result) => {
        if (
          readerInstanceIdRef.current === readerInstanceId
          && sequenceRef.current === sequence
          && result.selection.revisionId === reader.revision.revisionId
          && result.selection.fingerprint === previous.selection.fingerprint
          && result.operationId !== previous.operationId
        ) {
          setTranslation(result);
          setTranslationRanges((ranges) => upsertSummary(ranges, result));
          setTranslationStatus("idle");
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && sequenceRef.current === sequence) {
          setTranslationError(reason instanceof Error ? reason.message : "重新翻译失败");
          setTranslationStatus("error");
        }
      });
  }, [reader.revision.revisionId, translation]);

  const closeTranslation = useCallback(() => {
    translationAbortRef.current?.abort();
    sequenceRef.current += 1;
    pendingSelectionRef.current = null;
    setActiveSelectionText(null);
    setTranslationAnchor(null);
    setTranslation(null);
    setTranslationStatus("idle");
    rendererHandle?.clearSelection();
  }, [rendererHandle]);

  const closeRecall = useCallback(() => {
    setActiveRecall(null);
    setRecallError(null);
    setRecallStatus("idle");
  }, []);

  const closeAnnotation = useCallback(() => setActiveAnnotation(null), []);

  const replaceAnnotation = useCallback((annotation: Annotation) => {
    setActiveAnnotation(annotation.status === "active" ? annotation : null);
    setAnnotations((current) => annotation.status === "active"
      ? [...current.filter((item) => item.annotationId !== annotation.annotationId), annotation]
      : current.filter((item) => item.annotationId !== annotation.annotationId));
  }, []);

  const navigateTo = useCallback((blockId: string, behavior: ScrollBehavior) => {
    rendererHandle?.navigateTo(blockId, behavior);
  }, [rendererHandle]);

  return {
    activeAnnotation,
    activeRecall,
    activeSelectionText,
    closeAnnotation,
    closeRecall,
    closeTranslation,
    handleRendererEvent,
    linkNotice,
    navigateTo,
    recallError,
    recallStatus,
    replaceAnnotation,
    addAnnotation: replaceAnnotation,
    registerRenderer: setRendererHandle,
    renderError,
    retryActiveTranslation,
    translation,
    translationAnchor,
    translationError,
    translationStatus,
    visibleBlockIds,
    workspaceSelection,
  };
}
