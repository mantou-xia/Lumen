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
  ConversationReferenceInput,
  ProviderStatus,
  ReadingConversation,
  ReaderDocument,
  RecallEvaluation,
} from "@lumen/api-contract";

import { saveLearningItem } from "../api/learning";
import { openReaderBook, saveBookReadingProgress } from "../api/book";
import { evaluateRecall } from "../api/recall";
import { openReaderDocument, replaceMissingMarkdownImage } from "../api/reader";
import { getProviderStatus } from "../api/translation";
import { askConversation, openConversation } from "../api/conversation";
import { AppIcon } from "../app/AppIcon";
import { usePreferences } from "../app/preferences";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  ScrollArea,
  StatusNotice,
  TextField,
} from "../app/ui";
import { FormatRendererHost } from "../document-renderers/FormatRendererHost";
import { documentRendererRegistry } from "../document-renderers";
import {
  TranslationLens,
  useAnchoredOverlayPosition,
  type TranslationAnchor,
} from "./TranslationLens";
import {
  WorkspacePanel,
  type PendingConversationReference,
} from "./WorkspacePanel";
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
  const [renderHtml, setRenderHtml] = useState(reader.renderHtml);
  const [missingImageId, setMissingImageId] = useState<string | null>(null);
  const [replacementImage, setReplacementImage] = useState<File | null>(null);
  const [imageReplaceStatus, setImageReplaceStatus] = useState<"idle" | "uploading">("idle");
  const [imageReplaceError, setImageReplaceError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
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
  const [conversation, setConversation] = useState<ReadingConversation | null>(null);
  const [conversationReferences, setConversationReferences] = useState<PendingConversationReference[]>([]);
  const [conversationStatus, setConversationStatus] = useState<"idle" | "opening" | "asking" | "error">("opening");
  const [conversationError, setConversationError] = useState<string | null>(null);
  const showConversation = useCallback(() => {
    overlays.openOverlay("workspace");
  }, [overlays.openOverlay]);
  const coordinator = useInteractionCoordinator({
    documentId,
    reader,
    requestedBlockId,
    requestedRange,
    preferences,
    persistProgress: bookId === undefined ? undefined : persistBookProgress,
    openTranslationOverlay,
    openRecallOverlay,
    footnotes: conversation?.footnotes ?? [],
    onFootnoteActivated: () => showConversation(),
  });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [recallInterpretation, setRecallInterpretation] = useState("");
  const [recallEvaluation, setRecallEvaluation] = useState<RecallEvaluation | null>(null);
  const [evaluationStatus, setEvaluationStatus] = useState<"idle" | "evaluating" | "error">("idle");
  const [evaluationError, setEvaluationError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setConversationStatus("opening");
    setConversationError(null);
    void openConversation(documentId, reader.revision.revisionId, (request, init) => (
      fetch(request, { ...init, signal: controller.signal })
    )).then((restored) => {
      setConversation(restored);
      setConversationStatus("idle");
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setConversationError(reason instanceof Error ? reason.message : "无法打开 AI 阅读助手");
      setConversationStatus("error");
    });
    return () => controller.abort();
  }, [documentId, reader.revision.revisionId]);

  const addConversationReference = useCallback((reference: PendingConversationReference) => {
    setConversationReferences((current) => [
      ...current.filter((item) => item.key !== reference.key),
      reference,
    ]);
    showConversation();
  }, [showConversation]);

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
            aria-expanded={overlays.activeOverlay === "outline"}
            onClick={() => overlays.toggleOverlay("outline")}
          ><AppIcon icon={ListTree} size={16} />目录</Button>
          <Link to={settingsTarget}><AppIcon icon={Settings2} size={16} />阅读设置</Link>
        </nav>
      </header>

      <div className="reader-progressbar">
        <LinearProgress
          aria-label={`${book === null ? "文档" : "Book"} 阅读进度 ${progress}%`}
          className="reader-progress-indicator"
          value={progress}
          variant="determinate"
        />
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
          renderProjection={renderHtml}
          preferences={preferences}
          onEvent={coordinator.handleRendererEvent}
          onMissingImage={(resourceId) => {
            setMissingImageId(resourceId);
            setReplacementImage(null);
            setImageReplaceError(null);
          }}
          onReady={coordinator.registerRenderer}
        />

        <Dialog
          fullWidth
          maxWidth="sm"
          open={missingImageId !== null}
          onClose={() => {
            if (imageReplaceStatus === "uploading") return;
            setMissingImageId(null);
          }}
        >
          <DialogTitle>替换缺失图片</DialogTitle>
          <DialogContent className="reader-image-dialog">
            <p>原图片链接已经无法访问。请选择本机图片，替换当前文档中的这个位置。</p>
            <input
              hidden
              accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml"
              ref={imageInputRef}
              type="file"
              onChange={(event) => setReplacementImage(event.target.files?.[0] ?? null)}
            />
            <Button type="button" variant="secondary" onClick={() => imageInputRef.current?.click()}>
              选择图片
            </Button>
            {replacementImage !== null && <span>{replacementImage.name}</span>}
            {imageReplaceError !== null && <StatusNotice tone="danger">{imageReplaceError}</StatusNotice>}
          </DialogContent>
          <DialogActions>
            <Button
              disabled={imageReplaceStatus === "uploading"}
              type="button"
              variant="ghost"
              onClick={() => setMissingImageId(null)}
            >
              取消
            </Button>
            <Button
              disabled={replacementImage === null || imageReplaceStatus === "uploading"}
              type="button"
              onClick={() => {
                if (missingImageId === null || replacementImage === null) return;
                setImageReplaceStatus("uploading");
                setImageReplaceError(null);
                void replaceMissingMarkdownImage(
                  documentId,
                  reader.revision.revisionId,
                  missingImageId,
                  replacementImage,
                ).then((result) => {
                  setRenderHtml(result.renderHtml);
                  setMissingImageId(null);
                  setReplacementImage(null);
                  setImageReplaceStatus("idle");
                }).catch((reason: unknown) => {
                  setImageReplaceError(reason instanceof Error ? reason.message : "图片替换失败");
                  setImageReplaceStatus("idle");
                });
              }}
            >
              {imageReplaceStatus === "uploading" ? "正在上传…" : "上传并替换"}
            </Button>
          </DialogActions>
        </Dialog>

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
              coordinator.selectForWorkspace({
                start: coordinator.translation.selection.start,
                end: coordinator.translation.selection.end,
                selectedText: coordinator.translation.selection.selectedText,
              });
              showConversation();
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
            conversation={conversation}
            currentSelection={coordinator.workspaceSelection}
            error={conversationError}
            overlayRef={overlays.overlayRef}
            pendingReferences={conversationReferences}
            status={conversationStatus}
            onAsk={(question, intentHint) => {
              if (conversation === null) return;
              setConversationStatus("asking");
              setConversationError(null);
              const references: ConversationReferenceInput[] = [
                ...(coordinator.workspaceSelection === null ? [] : [{
                  type: "current_selection" as const,
                  ...coordinator.workspaceSelection,
                }]),
                ...conversationReferences.map((item) => item.input),
              ];
              void askConversation(conversation.conversationId, { question, references, intentHint })
                .then((turn) => {
                  setConversation((current) => current === null ? current : {
                    ...current,
                    turns: [...current.turns, turn],
                    footnotes: turn.footnote === null
                      ? current.footnotes
                      : [
                          ...current.footnotes.filter((item) => (
                            item.selectionFingerprint !== turn.footnote!.selectionFingerprint
                            || item.capabilityId !== turn.footnote!.capabilityId
                          )),
                          turn.footnote,
                        ],
                    updatedAt: turn.answer.createdAt,
                  });
                  setConversationReferences([]);
                  coordinator.clearWorkspaceSelection();
                  setConversationStatus("idle");
                })
                .catch((reason: unknown) => {
                  setConversationError(reason instanceof Error ? reason.message : "AI 对话回答失败");
                  setConversationStatus("error");
                });
            }}
            onClearSelection={coordinator.clearWorkspaceSelection}
            onClose={() => {
              overlays.closeOverlay("workspace");
            }}
            onNavigateReference={coordinator.navigateToWorkspaceReference}
            onReferenceTurn={(turnId, question) => addConversationReference({
              key: `conversation_turn:${turnId}`,
              label: `历史问答：${question || "解释选中内容"}`,
              input: { type: "conversation_turn", targetId: turnId },
            })}
            onRemoveReference={(key) => setConversationReferences((current) => (
              current.filter((reference) => reference.key !== key)
            ))}
          />
        )}
      </section>
      <IconButton
        aria-expanded={overlays.activeOverlay === "workspace"}
        className="workspace-floating-trigger"
        data-reader-overlay-trigger
        label="打开 AI 阅读助手"
        onClick={showConversation}
      >
        <AppIcon icon={MessageCircleMore} size={22} />
      </IconButton>
    </main>
  );
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
