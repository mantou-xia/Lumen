import {
  type CSSProperties,
  type MutableRefObject,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Brain,
  ChevronLeft,
  ChevronRight,
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
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import type {
  BookDetail,
  ProviderStatus,
  ReaderDocument,
  RecallEvaluation,
  WorkspaceReferenceInput,
  WorkspaceSession,
  WorkspaceSessionSummary,
} from "@lumen/api-contract";

import { saveLearningItem } from "../api/learning";
import { openReaderBook, saveBookReadingProgress } from "../api/book";
import { evaluateRecall } from "../api/recall";
import { openReaderDocument } from "../api/reader";
import { getProviderStatus } from "../api/translation";
import {
  askWorkspace,
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  openWorkspace,
} from "../api/workspace";
import { AppIcon } from "../app/AppIcon";
import { usePreferences } from "../app/preferences";
import { Button, IconButton, ScrollArea, TextField } from "../app/ui";
import { FormatRendererHost } from "../document-renderers/FormatRendererHost";
import { documentRendererRegistry } from "../document-renderers";
import {
  TranslationLens,
  useAnchoredOverlayPosition,
  type TranslationAnchor,
} from "./TranslationLens";
import { WorkspacePanel, type PendingWorkspaceReference } from "./WorkspacePanel";
import {
  buildOutlineTree,
  findActiveOutlineId,
  type OutlineTreeNode,
} from "./outline-tree";
import { useInteractionCoordinator } from "./useInteractionCoordinator";
import { useOverlayManager } from "./useOverlayManager";
import "./reader.css";

export function ReaderPage() {
  const { documentId, bookId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { preferences } = usePreferences();
  const [reader, setReader] = useState<ReaderDocument | null>(null);
  const [book, setBook] = useState<BookDetail | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [bookProgression, setBookProgression] = useState<number | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestedRevisionId = searchParams.get("revisionId") ?? undefined;
  const requestedPageId = searchParams.get("pageId") ?? undefined;

  useEffect(() => {
    if (documentId === undefined && bookId === undefined) return;
    const controller = new AbortController();
    if (bookId === undefined) {
      setReader(null);
      setBook(null);
      setActivePageId(null);
      setBookProgression(null);
    }
    setError(null);
    const fetchWithSignal = (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, signal: controller.signal });
    const request = bookId === undefined
      ? openReaderDocument(documentId!, requestedRevisionId, fetchWithSignal).then((result) => {
          setReader(result);
        })
      : openReaderBook(bookId, requestedPageId, fetchWithSignal).then((result) => {
          setBook(result.book);
          setActivePageId(result.activePageId);
          setBookProgression(result.bookProgression);
          setReader(result.document);
        });
    void request
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "无法打开阅读内容");
        }
      });
    return () => controller.abort();
  }, [bookId, documentId, requestedPageId, requestedRevisionId]);

  const handleNavigateBookPage = useCallback((pageId: string) => {
    setSearchParams({ pageId });
  }, [setSearchParams]);

  const handleBookProgressionChange = useCallback((progression: number) => {
    setBookProgression(progression);
  }, []);

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
  if (
    reader === null
    || (documentId === undefined && (bookId === undefined || book === null || activePageId === null))
  ) {
    return <main className="reader-loading">正在准备阅读内容…</main>;
  }

  return (
    <ReaderExperience
      key={`${bookId ?? "document"}:${activePageId ?? reader.revision.revisionId}`}
      activePageId={activePageId}
      book={book}
      bookId={bookId}
      bookProgression={bookProgression}
      documentId={reader.document.documentId}
      onBookProgressionChange={handleBookProgressionChange}
      onNavigateBookPage={handleNavigateBookPage}
      providerStatus={providerStatus}
      reader={reader}
      requestedBlockId={searchParams.get("block")}
      requestedRange={readRequestedRange(searchParams)}
      preferences={preferences}
    />
  );
}

function ReaderExperience({
  activePageId,
  book,
  bookId,
  bookProgression,
  documentId,
  onBookProgressionChange,
  onNavigateBookPage,
  preferences,
  providerStatus,
  reader,
  requestedBlockId,
  requestedRange,
}: {
  activePageId: string | null;
  book: BookDetail | null;
  bookId: string | undefined;
  bookProgression: number | null;
  documentId: string;
  onBookProgressionChange: (progression: number) => void;
  onNavigateBookPage: (pageId: string) => void;
  preferences: ReturnType<typeof usePreferences>["preferences"];
  providerStatus: ProviderStatus | null;
  reader: ReaderDocument;
  requestedBlockId: string | null;
  requestedRange: {
    start: { blockId: string; offset: number };
    end: { blockId: string; offset: number };
  } | null;
}) {
  const location = useLocation();
  const overlays = useOverlayManager();
  const openTranslationOverlay = useCallback(
    () => overlays.openOverlay("translation"),
    [overlays.openOverlay],
  );
  const openRecallOverlay = useCallback(
    () => overlays.openOverlay("recall"),
    [overlays.openOverlay],
  );
  const persistBookProgress = useCallback((progress: Parameters<typeof saveBookReadingProgress>[2]) => {
    if (bookId === undefined || activePageId === null) return Promise.resolve();
    return saveBookReadingProgress(bookId, activePageId, progress).then((saved) => {
      onBookProgressionChange(saved.bookProgression);
    });
  }, [activePageId, bookId, onBookProgressionChange]);
  const coordinator = useInteractionCoordinator({
    documentId,
    reader,
    requestedBlockId,
    requestedRange,
    preferences,
    persistProgress: bookId === undefined ? undefined : persistBookProgress,
    openTranslationOverlay,
    openRecallOverlay,
  });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [recallInterpretation, setRecallInterpretation] = useState("");
  const [recallEvaluation, setRecallEvaluation] = useState<RecallEvaluation | null>(null);
  const [evaluationStatus, setEvaluationStatus] = useState<"idle" | "evaluating" | "error">("idle");
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [workspaceSession, setWorkspaceSession] = useState<WorkspaceSession | null>(null);
  const [workspaceSessions, setWorkspaceSessions] = useState<WorkspaceSessionSummary[]>([]);
  const [workspaceReferences, setWorkspaceReferences] = useState<PendingWorkspaceReference[]>([]);
  const [workspaceStatus, setWorkspaceStatus] = useState<"idle" | "opening" | "asking" | "error">("idle");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const consumedReferenceCommitRef = useRef(0);

  const showWorkspace = useCallback(() => {
    overlays.openOverlay("workspace");
    if (workspaceSession !== null || workspaceStatus === "opening") return;
    setWorkspaceStatus("opening");
    setWorkspaceError(null);
    void openWorkspace(documentId, reader.revision.revisionId)
      .then(async (session) => {
        setWorkspaceSession(session);
        setWorkspaceSessions(await listWorkspaces(documentId, reader.revision.revisionId));
        setWorkspaceStatus("idle");
      })
      .catch((reason: unknown) => {
        setWorkspaceError(reason instanceof Error ? reason.message : "无法打开 AI 工作区");
        setWorkspaceStatus("error");
      });
  }, [documentId, overlays.openOverlay, reader.revision.revisionId, workspaceSession, workspaceStatus]);

  const switchWorkspaceSession = useCallback((sessionId: string) => {
    coordinator.stopReferenceMode();
    setWorkspaceReferences([]);
    setWorkspaceStatus("opening");
    setWorkspaceError(null);
    void getWorkspace(sessionId)
      .then((session) => {
        setWorkspaceSession(session);
        setWorkspaceStatus("idle");
      })
      .catch((reason: unknown) => {
        setWorkspaceError(reason instanceof Error ? reason.message : "无法切换 AI Workspace 会话");
        setWorkspaceStatus("error");
      });
  }, [coordinator.stopReferenceMode]);

  const createNewWorkspaceSession = useCallback(() => {
    coordinator.stopReferenceMode();
    setWorkspaceReferences([]);
    setWorkspaceStatus("opening");
    setWorkspaceError(null);
    void createWorkspace(documentId, reader.revision.revisionId)
      .then(async (session) => {
        setWorkspaceSession(session);
        setWorkspaceSessions(await listWorkspaces(documentId, reader.revision.revisionId));
        setWorkspaceStatus("idle");
      })
      .catch((reason: unknown) => {
        setWorkspaceError(reason instanceof Error ? reason.message : "无法新建 AI Workspace 会话");
        setWorkspaceStatus("error");
      });
  }, [coordinator.stopReferenceMode, documentId, reader.revision.revisionId]);

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

  useEffect(() => {
    if (overlays.activeOverlay !== "workspace") coordinator.stopReferenceMode();
  }, [coordinator.stopReferenceMode, overlays.activeOverlay]);

  useEffect(() => {
    const committed = coordinator.committedReferenceTarget;
    if (committed === null || committed.sequence <= consumedReferenceCommitRef.current) return;
    consumedReferenceCommitRef.current = committed.sequence;
    const { target } = committed;
    const kindLabel = target.kind === "word"
      ? "单词"
      : target.kind === "sentence"
        ? "句子"
        : "段落块";
    addWorkspaceReference({
      key: [
        "document",
        target.start.blockId,
        target.start.offset,
        target.end.blockId,
        target.end.offset,
      ].join(":"),
      label: `${kindLabel}：${target.selectedText}`,
      input: { type: "selection", ...target },
      navigation: {
        revisionId: target.revisionId,
        start: target.start,
        end: target.end,
        label: `${kindLabel}：${target.selectedText}`,
      },
    });
  }, [addWorkspaceReference, coordinator.committedReferenceTarget]);

  const activePageIndex = book?.pages.findIndex((page) => page.pageId === activePageId) ?? -1;
  const liveBookProgression = useMemo(() => {
    if (book === null || activePageIndex < 0) return null;
    const totalWeight = book.pages.reduce((total, page) => total + page.contentWeight, 0);
    if (totalWeight === 0) return bookProgression ?? 0;
    const completedWeight = book.pages
      .slice(0, activePageIndex)
      .reduce((total, page) => total + page.contentWeight, 0);
    const activeWeight = book.pages[activePageIndex]?.contentWeight ?? 0;
    return Math.min(1, Math.max(
      0,
      (completedWeight + activeWeight * coordinator.readingProgression) / totalWeight,
    ));
  }, [activePageIndex, book, bookProgression, coordinator.readingProgression]);
  const progress = Math.round((liveBookProgression ?? coordinator.readingProgression) * 100);
  const previousPage = activePageIndex > 0 ? book?.pages[activePageIndex - 1] : undefined;
  const nextPage = book !== null && activePageIndex >= 0 && activePageIndex < book.pages.length - 1
    ? book.pages[activePageIndex + 1]
    : undefined;
  const chapterEntries = reader.outline.filter((entry) => entry.depth === 2);
  const visibleBlockId = coordinator.visibleBlockIds[0];
  const blockOrder = useMemo(
    () => new Map(reader.blocks.map((block) => [block.blockId, block.order])),
    [reader.blocks],
  );
  const activeOutlineId = findActiveOutlineId(reader.outline, blockOrder, visibleBlockId);
  const activeChapterId = findActiveOutlineId(chapterEntries, blockOrder, visibleBlockId);
  const outlineTree = useMemo(() => buildOutlineTree(reader.outline), [reader.outline]);
  const settingsTarget = `/settings?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
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
            <strong>{book === null ? reader.document.title : `${book.title} · ${reader.document.title}`}</strong>
            <small>{book === null
              ? `${reader.revision.format.formatId} · ${reader.blocks.length} 个语义块`
              : `Page ${activePageIndex + 1}/${book.pages.length} · ${reader.blocks.length} 个语义块`}</small>
          </div>
        </div>
        <nav className="reader-top-actions" aria-label="阅读工具">
          {book !== null && (
            <>
              <IconButton
                disabled={previousPage === undefined}
                label="上一页"
                onClick={() => previousPage !== undefined && onNavigateBookPage(previousPage.pageId)}
              ><AppIcon icon={ChevronLeft} size={17} /></IconButton>
              <IconButton
                disabled={nextPage === undefined}
                label="下一页"
                onClick={() => nextPage !== undefined && onNavigateBookPage(nextPage.pageId)}
              ><AppIcon icon={ChevronRight} size={17} /></IconButton>
            </>
          )}
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
          <Link to={settingsTarget}><AppIcon icon={Settings2} size={16} />阅读设置</Link>
        </nav>
      </header>

      <div className="reader-progressbar" aria-label={`${book === null ? "文档" : "Book"} 阅读进度 ${progress}%`}>
        <span aria-hidden="true"><i style={{ width: `${progress}%` }} /></span>
        <strong>{progress}%</strong>
        <small>{book === null ? "文档阅读位置自动保存在本机" : "整本 Book 阅读位置自动保存在本机"}</small>
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
          <ScrollArea
            axis="y"
            className="reader-outline-panel"
            component="section"
            ref={overlays.overlayRef as Ref<HTMLElement>}
            data-reader-overlay
            tabIndex={-1}
          >
            <header>
              <strong>{book === null ? "文档目录" : "Book 目录"}</strong>
              <IconButton label="关闭目录" onClick={() => overlays.closeOverlay("outline")}>
                <AppIcon icon={X} size={15} />
              </IconButton>
            </header>
            {book !== null && (
              <nav className="reader-book-pages" aria-label="Book Page 列表">
                {book.pages.map((page) => (
                  <Button
                    aria-current={page.pageId === activePageId ? "page" : undefined}
                    className={page.pageId === activePageId ? "is-active" : undefined}
                    key={page.pageId}
                    type="button"
                    variant="ghost"
                    onClick={() => onNavigateBookPage(page.pageId)}
                  >
                    <span>{page.order + 1}</span>
                    <strong>{page.document.title}</strong>
                  </Button>
                ))}
              </nav>
            )}
            <div className="reader-document-outline">
              {book !== null && <small>当前 Page 目录</small>}
              {reader.outline.length === 0 ? (
                <p>这篇文档没有标题目录</p>
              ) : (
                <ReaderOutlineTree
                  activeOutlineId={activeOutlineId}
                  nodes={outlineTree}
                  onNavigate={(blockId) => coordinator.navigateTo(blockId, "smooth")}
                />
              )}
            </div>
          </ScrollArea>
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
                navigation: {
                  revisionId: coordinator.translation.selection.revisionId,
                  start: coordinator.translation.selection.start,
                  end: coordinator.translation.selection.end,
                  label: `翻译原文：${coordinator.translation.selection.selectedText}`,
                },
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
            canReferenceDocument={coordinator.canReferenceDocument}
            error={workspaceError}
            overlayRef={overlays.overlayRef}
            pendingReferences={workspaceReferences}
            referenceMode={coordinator.referenceMode}
            referenceTargetKind={coordinator.referenceTarget?.kind ?? null}
            session={workspaceSession}
            sessions={workspaceSessions}
            status={workspaceStatus}
            onAsk={(question) => {
              if (workspaceSession === null) return;
              setWorkspaceStatus("asking");
              setWorkspaceError(null);
              const references: WorkspaceReferenceInput[] = workspaceReferences.map((item) => item.input);
              void askWorkspace(workspaceSession.sessionId, { question, references })
                .then((turn) => {
                  setWorkspaceSession((current) => current === null ? current : {
                    ...current,
                    title: current.turns.length === 0 ? workspaceTitle(question) : current.title,
                    turns: [...current.turns, turn],
                    updatedAt: turn.answer.createdAt,
                  });
                  setWorkspaceSessions((current) => current.map((item) => (
                    item.sessionId === workspaceSession.sessionId
                      ? {
                          ...item,
                          title: item.title === "新会话" ? workspaceTitle(question) : item.title,
                          updatedAt: turn.answer.createdAt,
                        }
                      : item
                  )).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
                  setWorkspaceReferences([]);
                  setWorkspaceStatus("idle");
                })
                .catch((reason: unknown) => {
                  setWorkspaceError(reason instanceof Error ? reason.message : "Workspace 回答失败");
                  setWorkspaceStatus("error");
                });
            }}
            onClose={() => {
              coordinator.stopReferenceMode();
              overlays.closeOverlay("workspace");
            }}
            onCreateSession={createNewWorkspaceSession}
            onNavigateReference={coordinator.navigateToWorkspaceReference}
            onNavigatePendingReference={coordinator.navigateToWorkspaceReference}
            onReferenceTurn={(turnId, question) => addWorkspaceReference({
              key: `workspace_turn:${turnId}`,
              label: `历史问答：${question}`,
              input: { type: "workspace_turn", targetId: turnId },
            })}
            onRemoveReference={(key) => setWorkspaceReferences((current) => (
              current.filter((reference) => reference.key !== key)
            ))}
            onSwitchSession={switchWorkspaceSession}
            onToggleReferenceMode={() => {
              if (coordinator.referenceMode) coordinator.stopReferenceMode();
              else coordinator.startReferenceMode();
            }}
          />
        )}
      </section>
    </main>
  );
}

function workspaceTitle(question: string): string {
  const normalized = question.trim().replace(/\s+/gu, " ");
  return normalized.length <= 28 ? normalized : `${normalized.slice(0, 28)}…`;
}

function ReaderOutlineTree({
  activeOutlineId,
  nodes,
  onNavigate,
}: {
  activeOutlineId: string | null;
  nodes: readonly OutlineTreeNode[];
  onNavigate: (blockId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggle = (outlineId: string, expanded: boolean) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (expanded) next.add(outlineId);
      else next.delete(outlineId);
      return next;
    });
  };

  const renderNodes = (items: readonly OutlineTreeNode[]): React.ReactNode => items.map((node) => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.entry.outlineId);
    return (
      <div className="reader-outline-node" key={node.entry.outlineId} role="none">
        <Button
          aria-current={node.entry.outlineId === activeOutlineId ? "location" : undefined}
          aria-expanded={hasChildren ? !isCollapsed : undefined}
          aria-level={node.entry.depth}
          className={`outline-link${node.entry.outlineId === activeOutlineId ? " is-active" : ""}`}
          role="treeitem"
          style={{ "--outline-depth": node.entry.depth } as CSSProperties}
          type="button"
          variant="ghost"
          onClick={(event) => {
            if (hasChildren && (event.target as Element).closest("[data-outline-toggle]") !== null) {
              toggle(node.entry.outlineId, !isCollapsed);
              return;
            }
            onNavigate(node.entry.blockId);
          }}
          onKeyDown={(event) => {
            if (!hasChildren) return;
            if (event.key === "ArrowLeft" && !isCollapsed) {
              event.preventDefault();
              toggle(node.entry.outlineId, true);
            }
            if (event.key === "ArrowRight" && isCollapsed) {
              event.preventDefault();
              toggle(node.entry.outlineId, false);
            }
          }}
        >
          <span className="outline-toggle" data-outline-toggle aria-hidden="true">
            {hasChildren && <AppIcon icon={ChevronRight} size={14} />}
          </span>
          <span>{node.entry.label}</span>
        </Button>
        {hasChildren && !isCollapsed && (
          <div className="reader-outline-children" role="group">
            {renderNodes(node.children)}
          </div>
        )}
      </div>
    );
  });

  return <nav aria-label="文档目录树" className="reader-outline-tree" role="tree">{renderNodes(nodes)}</nav>;
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
    <ScrollArea
      axis="y"
      className="translation-lens recall-panel"
      component="aside"
      ref={setRefs}
      data-reader-overlay
      tabIndex={-1}
      aria-live="polite"
      style={style}
    >
      {children}
    </ScrollArea>
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
