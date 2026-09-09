import {
  type CSSProperties,
  type MutableRefObject,
  type Ref,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  ArrowLeft,
  Brain,
  CircleCheck,
  CircleHelp,
  ListTree,
  LoaderCircle,
  MessageCircleMore,
  Send,
  Settings2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router";
import type {
  ProviderStatus,
  ReaderDocument,
  RecallEvaluation,
  WorkspaceReferenceInput,
  WorkspaceSession,
} from "@lumen/api-contract";

import { saveLearningItem } from "../api/learning";
import { evaluateRecall } from "../api/recall";
import { openReaderDocument } from "../api/reader";
import { getProviderStatus } from "../api/translation";
import { askWorkspace, openWorkspace } from "../api/workspace";
import { AppIcon } from "../app/AppIcon";
import { usePreferences } from "../app/preferences";
import { Button, IconButton, TextField } from "../app/ui";
import { FormatRendererHost } from "../document-renderers/FormatRendererHost";
import { documentRendererRegistry } from "../document-renderers";
import {
  TranslationLens,
  useAnchoredOverlayPosition,
  type TranslationAnchor,
} from "./TranslationLens";
import { WorkspacePanel, type PendingWorkspaceReference } from "./WorkspacePanel";
import { useInteractionCoordinator } from "./useInteractionCoordinator";
import { useOverlayManager } from "./useOverlayManager";
import "./reader.css";

export function ReaderPage() {
  const { documentId } = useParams();
  const [searchParams] = useSearchParams();
  const { preferences } = usePreferences();
  const [reader, setReader] = useState<ReaderDocument | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestedRevisionId = searchParams.get("revisionId") ?? undefined;

  useEffect(() => {
    if (documentId === undefined) return;
    const controller = new AbortController();
    setReader(null);
    setError(null);
    void openReaderDocument(documentId, requestedRevisionId, (input, init) =>
      fetch(input, { ...init, signal: controller.signal }),
    )
      .then(setReader)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "无法打开文档");
        }
      });
    return () => controller.abort();
  }, [documentId, requestedRevisionId]);

  useEffect(() => {
    void getProviderStatus().then(setProviderStatus).catch(() => undefined);
  }, []);

  if (error !== null) {
    return (
      <main className="reader-loading">
        <p className="notice notice--error">{error}</p>
        <Link to="/">返回文档库</Link>
      </main>
    );
  }
  if (reader === null || documentId === undefined) {
    return <main className="reader-loading">正在准备阅读内容…</main>;
  }

  return (
    <ReaderExperience
      key={reader.revision.revisionId}
      documentId={documentId}
      providerStatus={providerStatus}
      reader={reader}
      requestedBlockId={searchParams.get("block")}
      requestedRange={readRequestedRange(searchParams)}
      preferences={preferences}
    />
  );
}

function ReaderExperience({
  documentId,
  preferences,
  providerStatus,
  reader,
  requestedBlockId,
  requestedRange,
}: {
  documentId: string;
  preferences: ReturnType<typeof usePreferences>["preferences"];
  providerStatus: ProviderStatus | null;
  reader: ReaderDocument;
  requestedBlockId: string | null;
  requestedRange: {
    start: { blockId: string; offset: number };
    end: { blockId: string; offset: number };
  } | null;
}) {
  const overlays = useOverlayManager();
  const openTranslationOverlay = useCallback(
    () => overlays.openOverlay("translation"),
    [overlays.openOverlay],
  );
  const openRecallOverlay = useCallback(
    () => overlays.openOverlay("recall"),
    [overlays.openOverlay],
  );
  const coordinator = useInteractionCoordinator({
    documentId,
    reader,
    requestedBlockId,
    requestedRange,
    preferences,
    openTranslationOverlay,
    openRecallOverlay,
  });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [recallInterpretation, setRecallInterpretation] = useState("");
  const [recallEvaluation, setRecallEvaluation] = useState<RecallEvaluation | null>(null);
  const [evaluationStatus, setEvaluationStatus] = useState<"idle" | "evaluating" | "error">("idle");
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [workspaceSession, setWorkspaceSession] = useState<WorkspaceSession | null>(null);
  const [workspaceReferences, setWorkspaceReferences] = useState<PendingWorkspaceReference[]>([]);
  const [workspaceStatus, setWorkspaceStatus] = useState<"idle" | "opening" | "asking" | "error">("idle");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const showWorkspace = useCallback(() => {
    overlays.openOverlay("workspace");
    if (workspaceSession !== null || workspaceStatus === "opening") return;
    setWorkspaceStatus("opening");
    setWorkspaceError(null);
    void openWorkspace(documentId, reader.revision.revisionId)
      .then((session) => {
        setWorkspaceSession(session);
        setWorkspaceStatus("idle");
      })
      .catch((reason: unknown) => {
        setWorkspaceError(reason instanceof Error ? reason.message : "无法打开 AI 工作区");
        setWorkspaceStatus("error");
      });
  }, [documentId, overlays.openOverlay, reader.revision.revisionId, workspaceSession, workspaceStatus]);

  const addWorkspaceReference = useCallback((reference: PendingWorkspaceReference) => {
    setWorkspaceReferences((current) => [
      ...current.filter((item) => item.key !== reference.key),
      reference,
    ]);
    showWorkspace();
  }, [showWorkspace]);

  useEffect(() => {
    setSaveState("idle");
  }, [coordinator.translation?.translationId]);

  useEffect(() => {
    setRecallInterpretation("");
    setRecallEvaluation(null);
    setEvaluationStatus("idle");
    setEvaluationError(null);
  }, [coordinator.activeRecall?.occurrenceId]);

  useEffect(() => {
    if (overlays.activeOverlay !== "translation") coordinator.closeTranslation();
  }, [coordinator.closeTranslation, overlays.activeOverlay]);

  useEffect(() => {
    if (overlays.activeOverlay !== "recall") coordinator.closeRecall();
  }, [coordinator.closeRecall, overlays.activeOverlay]);

  const progress = Math.round((reader.progress?.progression ?? 0) * 100);
  const chapterEntries = reader.outline.filter((entry) => entry.depth === 2);
  const visibleBlockId = coordinator.visibleBlockIds[0];
  const visibleBlockIndex = reader.blocks.findIndex((block) => block.blockId === visibleBlockId);
  const activeChapterId = chapterEntries.reduce<string | null>((active, entry) => {
    const chapterBlockIndex = reader.blocks.findIndex((block) => block.blockId === entry.blockId);
    return chapterBlockIndex <= visibleBlockIndex ? entry.outlineId : active;
  }, chapterEntries[0]?.outlineId ?? null);
  const readerStyle = {
    "--reader-content-width": `${preferences.readingWidth}px`,
    "--reader-font-size": `${preferences.readingFontSize}px`,
    "--reader-line-height": preferences.readingLineHeight,
  } as CSSProperties;

  return (
    <main
      className="immersive-reader"
      style={readerStyle}
      onPointerDown={(event) => overlays.handleRootPointerDown(event.target)}
    >
      <header className="reader-topbar">
        <div className="reader-document-identity">
          <Link to="/"><AppIcon icon={ArrowLeft} size={15} />文档库</Link>
          <span aria-hidden="true" />
          <div>
            <strong>{reader.document.title}</strong>
            <small>{reader.revision.format.formatId} · {reader.blocks.length} 个语义块</small>
          </div>
        </div>
        <nav className="reader-top-actions" aria-label="阅读工具">
          <Button
            data-reader-overlay-trigger
            type="button"
            variant="ghost"
            aria-expanded={overlays.activeOverlay === "workspace"}
            onClick={showWorkspace}
          ><AppIcon icon={MessageCircleMore} size={16} />AI 工作区</Button>
          <Button
            data-reader-overlay-trigger
            type="button"
            variant="ghost"
            aria-expanded={overlays.activeOverlay === "outline"}
            onClick={() => overlays.toggleOverlay("outline")}
          ><AppIcon icon={ListTree} size={16} />目录</Button>
          <Link to="/settings"><AppIcon icon={Settings2} size={16} />阅读设置</Link>
        </nav>
      </header>

      <div className="reader-progressbar" aria-label={`阅读进度 ${progress}%`}>
        <span aria-hidden="true"><i style={{ width: `${progress}%` }} /></span>
        <strong>{progress}%</strong>
        <small>阅读位置自动保存在本机</small>
      </div>

      <aside className="reader-outline-rail" aria-label="目录导航">
        {chapterEntries.length > 0 && (
          <nav className="reader-outline-dots" aria-label="二级标题快速导航">
            {chapterEntries.map((entry) => (
              <IconButton
                className={entry.outlineId === activeChapterId ? "is-active" : undefined}
                key={entry.outlineId}
                label={`前往章节：${entry.label}`}
                onClick={() => coordinator.navigateTo(entry.blockId, "smooth")}
              />
            ))}
          </nav>
        )}
        <IconButton
          data-reader-overlay-trigger
          label="打开文档目录"
          aria-expanded={overlays.activeOverlay === "outline"}
          onClick={() => overlays.toggleOverlay("outline")}
        ><AppIcon icon={ListTree} size={16} /></IconButton>
        {overlays.activeOverlay === "outline" && (
          <section
            className="reader-outline-panel"
            ref={overlays.overlayRef as Ref<HTMLElement>}
            data-reader-overlay
            tabIndex={-1}
          >
            <header>
              <strong>文档目录</strong>
              <IconButton label="关闭目录" onClick={() => overlays.closeOverlay("outline")}>
                <AppIcon icon={X} size={15} />
              </IconButton>
            </header>
            {reader.outline.length === 0 ? (
              <p>这篇文档没有标题目录</p>
            ) : reader.outline.map((entry) => (
              <Button
                className="outline-link"
                key={entry.outlineId}
                style={{ paddingInlineStart: `${Math.max(0, entry.depth - 1) * 0.8 + 0.5}rem` }}
                type="button"
                variant="ghost"
                onClick={() => {
                  coordinator.navigateTo(entry.blockId, "smooth");
                  overlays.closeOverlay("outline");
                }}
              >
                {entry.label}
              </Button>
            ))}
          </section>
        )}
      </aside>

      <section className="reader-paper reading-stage">
        {providerStatus !== null && !providerStatus.configured && (
          <p className="reader-notice" role="status">
            阅读功能可正常使用；配置本机 AI Provider 后即可使用划词翻译与 Recall 判断。
          </p>
        )}
        {coordinator.linkNotice !== null && <p className="reader-notice" role="status">{coordinator.linkNotice}</p>}
        {coordinator.renderError !== null && <p className="reader-notice" role="alert">{coordinator.renderError}</p>}

        <FormatRendererHost
          registry={documentRendererRegistry}
          descriptor={reader.revision.format}
          revisionId={reader.revision.revisionId}
          renderProjection={reader.renderHtml}
          preferences={preferences}
          onEvent={coordinator.handleRendererEvent}
          onReady={coordinator.registerRenderer}
        />

        {overlays.activeOverlay === "translation" && (
          <TranslationLens
            activeSelectionText={coordinator.activeSelectionText}
            anchor={coordinator.translationAnchor}
            error={coordinator.translationError}
            overlayRef={overlays.overlayRef}
            saveState={saveState}
            status={coordinator.translationStatus}
            translation={coordinator.translation}
            onRetry={coordinator.retryActiveTranslation}
            onReferenceWorkspace={() => {
              if (coordinator.translation === null) return;
              addWorkspaceReference({
                key: `translation:${coordinator.translation.translationId}`,
                label: `翻译：${coordinator.translation.selection.selectedText}`,
                input: { type: "translation", targetId: coordinator.translation.translationId },
              });
            }}
            onSave={() => {
              if (coordinator.translation === null) return;
              setSaveState("saving");
              void saveLearningItem(coordinator.translation.translationId)
                .then(() => setSaveState("saved"))
                .catch(() => setSaveState("error"));
            }}
          />
        )}

        {overlays.activeOverlay === "recall" && (
          <RecallBubble anchor={coordinator.recallAnchor} overlayRef={overlays.overlayRef}>
            {coordinator.recallStatus === "opening" && <p>正在打开这次回忆…</p>}
            {coordinator.recallError !== null && <p className="lens-error">{coordinator.recallError}</p>}
            {coordinator.activeRecall !== null && (
              <>
                <p className="lens-expression"><AppIcon icon={Brain} size={15} />Recall · {coordinator.activeRecall.surfaceForm}</p>
                {recallEvaluation === null ? (
                  <>
                    <label htmlFor="recall-interpretation">先写下你在当前语境中的理解</label>
                    <TextField
                      fullWidth
                      multiline
                      id="recall-interpretation"
                      value={recallInterpretation}
                      onChange={(event) => setRecallInterpretation(event.target.value)}
                      rows={4}
                    />
                    <Button
                      type="button"
                      disabled={recallInterpretation.trim().length === 0 || evaluationStatus === "evaluating"}
                      onClick={() => {
                        setEvaluationStatus("evaluating");
                        setEvaluationError(null);
                        void evaluateRecall(coordinator.activeRecall!.occurrenceId, recallInterpretation)
                          .then((result) => {
                            setRecallEvaluation(result);
                            setEvaluationStatus("idle");
                          })
                          .catch((reason: unknown) => {
                            setEvaluationError(reason instanceof Error ? reason.message : "Recall 判断失败");
                            setEvaluationStatus("error");
                          });
                      }}
                    >
                      <AppIcon
                        className={evaluationStatus === "evaluating" ? "is-spinning" : undefined}
                        icon={evaluationStatus === "evaluating" ? LoaderCircle : Send}
                        size={16}
                      />
                      {evaluationStatus === "evaluating" ? "正在判断…" : "提交我的理解"}
                    </Button>
                    {evaluationError !== null && <p className="lens-error">{evaluationError}</p>}
                  </>
                ) : (
                  <div className={`recall-result recall-result--${recallEvaluation.verdict}`}>
                    <strong><RecallVerdictIcon verdict={recallEvaluation.verdict} />{verdictLabel(recallEvaluation.verdict)}</strong>
                    <p>{recallEvaluation.feedback}</p>
                    <p>{recallEvaluation.contextualMeaning}</p>
                    {recallEvaluation.missingPoints.length > 0 && (
                      <ul>{recallEvaluation.missingPoints.map((point) => <li key={point}>{point}</li>)}</ul>
                    )}
                  </div>
                )}
              </>
            )}
          </RecallBubble>
        )}

        {overlays.activeOverlay === "workspace" && (
          <WorkspacePanel
            canAddParagraph={coordinator.visibleBlockIds.length > 0}
            canAddSelection={coordinator.workspaceSelection !== null}
            error={workspaceError}
            overlayRef={overlays.overlayRef}
            pendingReferences={workspaceReferences}
            session={workspaceSession}
            status={workspaceStatus}
            onAddParagraph={() => {
              const blockId = coordinator.visibleBlockIds[0];
              if (blockId === undefined) return;
              addWorkspaceReference({
                key: `paragraph:${blockId}`,
                label: "当前可见段落",
                input: { type: "paragraph", targetId: blockId },
              });
            }}
            onAddSelection={() => {
              if (coordinator.workspaceSelection === null) return;
              const selection = coordinator.workspaceSelection;
              addWorkspaceReference({
                key: [
                  "selection",
                  selection.start.blockId,
                  selection.start.offset,
                  selection.end.blockId,
                  selection.end.offset,
                ].join(":"),
                label: `选区：${selection.selectedText}`,
                input: { type: "selection", ...selection },
              });
            }}
            onAsk={(question) => {
              if (workspaceSession === null) return;
              setWorkspaceStatus("asking");
              setWorkspaceError(null);
              const references: WorkspaceReferenceInput[] = workspaceReferences.map((item) => item.input);
              void askWorkspace(workspaceSession.sessionId, { question, references })
                .then((turn) => {
                  setWorkspaceSession((current) => current === null ? current : {
                    ...current,
                    turns: [...current.turns, turn],
                    updatedAt: turn.answer.createdAt,
                  });
                  setWorkspaceReferences([]);
                  setWorkspaceStatus("idle");
                })
                .catch((reason: unknown) => {
                  setWorkspaceError(reason instanceof Error ? reason.message : "Workspace 回答失败");
                  setWorkspaceStatus("error");
                });
            }}
            onClose={() => overlays.closeOverlay("workspace")}
            onReferenceTurn={(turnId, question) => addWorkspaceReference({
              key: `workspace_turn:${turnId}`,
              label: `历史问答：${question}`,
              input: { type: "workspace_turn", targetId: turnId },
            })}
            onRemoveReference={(key) => setWorkspaceReferences((current) => (
              current.filter((reference) => reference.key !== key)
            ))}
          />
        )}
      </section>
    </main>
  );
}

function RecallBubble({
  anchor,
  children,
  overlayRef,
}: {
  anchor: TranslationAnchor | null;
  children: React.ReactNode;
  overlayRef: MutableRefObject<HTMLElement | null>;
}) {
  const { lensRef, style } = useAnchoredOverlayPosition(anchor);
  const setRefs = useCallback((element: HTMLElement | null) => {
    lensRef.current = element;
    overlayRef.current = element;
  }, [lensRef, overlayRef]);
  return (
    <aside
      className="translation-lens recall-panel"
      ref={setRefs}
      data-reader-overlay
      tabIndex={-1}
      aria-live="polite"
      style={style}
    >
      {children}
    </aside>
  );
}

function readRequestedRange(searchParams: URLSearchParams) {
  const startBlockId = searchParams.get("block");
  const endBlockId = searchParams.get("endBlock");
  const startOffset = Number(searchParams.get("startOffset"));
  const endOffset = Number(searchParams.get("endOffset"));
  if (
    startBlockId === null
    || endBlockId === null
    || !Number.isInteger(startOffset)
    || startOffset < 0
    || !Number.isInteger(endOffset)
    || endOffset < 0
  ) return null;
  return {
    start: { blockId: startBlockId, offset: startOffset },
    end: { blockId: endBlockId, offset: endOffset },
  };
}

function verdictLabel(verdict: RecallEvaluation["verdict"]): string {
  if (verdict === "understood") return "理解准确";
  if (verdict === "partially_understood") return "部分理解";
  return "需要再留意";
}

function RecallVerdictIcon({ verdict }: { verdict: RecallEvaluation["verdict"] }) {
  const icon = verdict === "understood"
    ? CircleCheck
    : verdict === "partially_understood"
      ? CircleHelp
      : TriangleAlert;
  return <AppIcon icon={icon} size={17} />;
}
