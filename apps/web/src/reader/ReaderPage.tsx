import { type MouseEvent, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import type {
  ProviderStatus,
  ReaderDocument,
  TranslationResult,
  UpdateReadingProgressRequest,
  RecallEvaluation,
  RecallMatch,
  RecallOccurrence,
} from "@lumen/api-contract";

import { openReaderDocument, saveReadingProgress } from "../api/reader";
import { getProviderStatus, translateSelection } from "../api/translation";
import { saveLearningItem } from "../api/learning";
import { evaluateRecall, getRecallMatches, openRecallOccurrence } from "../api/recall";

export function ReaderPage() {
  const { documentId } = useParams();
  const [searchParams] = useSearchParams();
  const [reader, setReader] = useState<ReaderDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [translation, setTranslation] = useState<TranslationResult | null>(null);
  const [translationStatus, setTranslationStatus] = useState<"idle" | "loading" | "error">("idle");
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [recallMatches, setRecallMatches] = useState<RecallMatch[]>([]);
  const [activeRecall, setActiveRecall] = useState<RecallOccurrence | null>(null);
  const [recallInterpretation, setRecallInterpretation] = useState("");
  const [recallEvaluation, setRecallEvaluation] = useState<RecallEvaluation | null>(null);
  const [recallStatus, setRecallStatus] = useState<"idle" | "opening" | "evaluating" | "error">("idle");
  const [recallError, setRecallError] = useState<string | null>(null);
  const contentRef = useRef<HTMLElement>(null);
  const lastProgressRef = useRef<UpdateReadingProgressRequest | null>(null);
  const selectionSequenceRef = useRef(0);
  const translationAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (documentId === undefined) return;
    const controller = new AbortController();
    void openReaderDocument(documentId, (input, init) =>
      fetch(input, { ...init, signal: controller.signal }),
    )
      .then(setReader)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "无法打开文档");
        }
      });
    return () => controller.abort();
  }, [documentId]);

  useEffect(() => {
    void getProviderStatus().then(setProviderStatus).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (reader === null || documentId === undefined) return;
    const requestedBlockId = searchParams.get("block");
    const restoredBlockId = requestedBlockId ?? (
      reader.progress?.revisionId === reader.revision.revisionId ? reader.progress.blockId : null
    );
    if (restoredBlockId !== null) {
      requestAnimationFrame(() => navigateToBlock(restoredBlockId, "auto"));
    }

    let timer: number | undefined;
    const updatePosition = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const elements = Array.from(
          contentRef.current?.querySelectorAll<HTMLElement>("[data-block-id]") ?? [],
        );
        if (elements.length === 0) return;
        const currentIndex = Math.max(
          0,
          elements.findLastIndex((element) => element.getBoundingClientRect().top <= 140),
        );
        const current = elements[currentIndex];
        const blockId = current?.dataset.blockId;
        if (blockId === undefined) return;
        const progress = {
          revisionId: reader.revision.revisionId,
          blockId,
          offset: 0,
          progression: elements.length === 1 ? 1 : currentIndex / (elements.length - 1),
        };
        lastProgressRef.current = progress;
        void saveReadingProgress(documentId, progress).catch(() => undefined);
      }, 500);
    };

    window.addEventListener("scroll", updatePosition, { passive: true });
    updatePosition();
    return () => {
      window.removeEventListener("scroll", updatePosition);
      window.clearTimeout(timer);
      const latest = lastProgressRef.current;
      if (latest !== null) void saveReadingProgress(documentId, latest).catch(() => undefined);
    };
  }, [documentId, reader, searchParams]);

  useEffect(() => {
    if (reader === null || documentId === undefined || contentRef.current === null) return;
    let timer: number | undefined;
    const scanVisibleBlocks = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const viewportHeight = window.innerHeight;
        const blockIds = Array.from(
          contentRef.current?.querySelectorAll<HTMLElement>("[data-block-id]") ?? [],
        )
          .filter((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.bottom >= -80 && bounds.top <= viewportHeight + 80;
          })
          .map((element) => element.dataset.blockId)
          .filter((blockId): blockId is string => blockId !== undefined);
        if (blockIds.length === 0) return;
        void getRecallMatches(documentId, reader.revision.revisionId, blockIds)
          .then(setRecallMatches)
          .catch((reason: unknown) => {
            setRecallError(reason instanceof Error ? reason.message : "Recall 匹配失败");
          });
      }, 180);
    };
    window.addEventListener("scroll", scanVisibleBlocks, { passive: true });
    window.addEventListener("resize", scanVisibleBlocks);
    scanVisibleBlocks();
    return () => {
      window.removeEventListener("scroll", scanVisibleBlocks);
      window.removeEventListener("resize", scanVisibleBlocks);
      window.clearTimeout(timer);
    };
  }, [documentId, reader]);

  useEffect(() => {
    const root = contentRef.current;
    if (root === null) return;
    root.querySelectorAll(".recall-marker").forEach((element) => element.remove());
    root.querySelectorAll(".has-recall-match").forEach((element) => element.classList.remove("has-recall-match"));
    const firstMatchByBlock = new Map<string, RecallMatch>();
    for (const match of recallMatches) {
      if (!firstMatchByBlock.has(match.blockId)) firstMatchByBlock.set(match.blockId, match);
    }
    for (const [blockId, match] of firstMatchByBlock) {
      const block = root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
      if (block === null) continue;
      block.classList.add("has-recall-match");
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "recall-marker";
      marker.setAttribute("aria-label", `回忆表达：${match.surfaceForm}`);
      marker.title = `再次遇见：${match.surfaceForm}`;
      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        setRecallStatus("opening");
        setRecallError(null);
        setRecallEvaluation(null);
        setRecallInterpretation("");
        void openRecallOccurrence(reader!.revision.revisionId, match)
          .then((occurrence) => {
            setActiveRecall(occurrence);
            setRecallStatus("idle");
          })
          .catch((reason: unknown) => {
            setRecallError(reason instanceof Error ? reason.message : "无法打开 Recall");
            setRecallStatus("error");
          });
      });
      block.append(marker);
    }
    return () => {
      root.querySelectorAll(".recall-marker").forEach((element) => element.remove());
      root.querySelectorAll(".has-recall-match").forEach((element) => element.classList.remove("has-recall-match"));
    };
  }, [reader, recallMatches]);

  const handleContentClick = (event: MouseEvent<HTMLElement>) => {
    const link = (event.target as HTMLElement).closest("a");
    if (link !== null) {
      event.preventDefault();
      setLinkNotice(`文档外部链接已阻止自动打开：${link.textContent ?? "未命名链接"}`);
    }
  };

  const handleSelectionCommit = async () => {
    if (reader === null || documentId === undefined) return;
    const candidate = readSelectionCandidate(contentRef.current);
    if (candidate === null) return;

    selectionSequenceRef.current += 1;
    const sequence = selectionSequenceRef.current;
    translationAbortRef.current?.abort();
    const controller = new AbortController();
    translationAbortRef.current = controller;
    setTranslation(null);
    setSaveState("idle");
    setTranslationError(null);
    setTranslationStatus("loading");
    try {
      const result = await translateSelection(
        documentId,
        { revisionId: reader.revision.revisionId, ...candidate },
        controller.signal,
      );
      if (selectionSequenceRef.current === sequence) {
        setTranslation(result);
        setTranslationStatus("idle");
      }
    } catch (reason) {
      if (!controller.signal.aborted && selectionSequenceRef.current === sequence) {
        setTranslationError(reason instanceof Error ? reason.message : "翻译失败");
        setTranslationStatus("error");
      }
    }
  };

  if (error !== null) {
    return <main className="reader-loading"><p className="notice notice--error">{error}</p><Link to="/">返回文档库</Link></main>;
  }
  if (reader === null) {
    return <main className="reader-loading">正在准备阅读内容…</main>;
  }

  return (
    <main className="reader-shell">
      <aside className="reader-sidebar">
        <Link className="back-link" to="/">← 文档库</Link>
        <p className="section-label">Contents</p>
        <h1>{reader.document.title}</h1>
        <nav aria-label="文档目录">
          {reader.outline.length === 0 ? (
            <p className="outline-empty">这篇文档没有标题目录</p>
          ) : reader.outline.map((entry) => (
            <button
              className="outline-link"
              key={entry.outlineId}
              style={{ paddingInlineStart: `${Math.max(0, entry.depth - 1) * 0.8}rem` }}
              type="button"
              onClick={() => navigateToBlock(entry.blockId, "smooth")}
            >
              {entry.label}
            </button>
          ))}
        </nav>
        <p className="reader-meta">{reader.blocks.length} 个语义块 · 阅读位置自动保存在本机</p>
      </aside>

      <section className="reading-stage">
        {providerStatus !== null && !providerStatus.configured && (
          <p className="notice provider-notice" role="status">
            {providerStatus.provider === "deepseek"
              ? "阅读功能可正常使用；在根目录 .env 中填写 LUMEN_AI_API_KEY 后即可使用 DeepSeek 翻译。"
              : "阅读功能可正常使用；配置 LUMEN_AI_BASE_URL 与 LUMEN_AI_MODEL 后即可使用通用中转站翻译。"}
          </p>
        )}
        {linkNotice !== null && <p className="notice" role="status">{linkNotice}</p>}
        <article
          className="markdown-reader"
          ref={contentRef}
          onClick={handleContentClick}
          onMouseUp={() => void handleSelectionCommit()}
          onKeyUp={() => void handleSelectionCommit()}
          dangerouslySetInnerHTML={{ __html: reader.renderHtml }}
        />
        {(translationStatus !== "idle" || translation !== null) && (
          <aside className="translation-lens" aria-live="polite">
            <button
              className="lens-close"
              type="button"
              aria-label="关闭翻译"
              onClick={() => {
                translationAbortRef.current?.abort();
                selectionSequenceRef.current += 1;
                setTranslation(null);
                setTranslationStatus("idle");
              }}
            >×</button>
            {translationStatus === "loading" && <p>正在结合当前语境理解…</p>}
            {translationStatus === "error" && <p className="lens-error">{translationError}</p>}
            {translation !== null && (
              <>
                <p className="lens-expression">{translation.selection.selectedText}</p>
                <h2>{translation.contextualTranslation}</h2>
                <p>{translation.contextualMeaning}</p>
                {translation.explanation.length > 0 && <p className="lens-detail">{translation.explanation}</p>}
                {translation.uncertainty.length > 0 && <p className="lens-uncertainty">{translation.uncertainty}</p>}
                <button
                  className="save-expression"
                  type="button"
                  disabled={saveState === "saving" || saveState === "saved"}
                  onClick={() => {
                    setSaveState("saving");
                    void saveLearningItem(translation.translationId)
                      .then(() => setSaveState("saved"))
                      .catch(() => setSaveState("error"));
                  }}
                >
                  {saveState === "saving" && "正在收藏…"}
                  {saveState === "saved" && "已收藏"}
                  {saveState === "error" && "收藏失败，重试"}
                  {saveState === "idle" && "收藏这个表达"}
                </button>
              </>
            )}
          </aside>
        )}
        {(activeRecall !== null || recallStatus === "opening" || recallError !== null) && (
          <aside className="recall-panel" aria-live="polite">
            <button
              className="lens-close"
              type="button"
              aria-label="关闭 Recall"
              onClick={() => {
                setActiveRecall(null);
                setRecallEvaluation(null);
                setRecallError(null);
              }}
            >×</button>
            {recallStatus === "opening" && <p>正在打开这次回忆…</p>}
            {recallError !== null && <p className="lens-error">{recallError}</p>}
            {activeRecall !== null && (
              <>
                <p className="lens-expression">Recall · {activeRecall.surfaceForm}</p>
                <p className="recall-context">{activeRecall.currentContext}</p>
                {recallEvaluation === null ? (
                  <>
                    <label htmlFor="recall-interpretation">先写下你在当前语境中的理解</label>
                    <textarea
                      id="recall-interpretation"
                      value={recallInterpretation}
                      onChange={(event) => setRecallInterpretation(event.target.value)}
                      rows={4}
                    />
                    <button
                      type="button"
                      disabled={recallInterpretation.trim().length === 0 || recallStatus === "evaluating"}
                      onClick={() => {
                        setRecallStatus("evaluating");
                        setRecallError(null);
                        void evaluateRecall(activeRecall.occurrenceId, recallInterpretation)
                          .then((result) => {
                            setRecallEvaluation(result);
                            setRecallStatus("idle");
                          })
                          .catch((reason: unknown) => {
                            setRecallError(reason instanceof Error ? reason.message : "Recall 判断失败");
                            setRecallStatus("error");
                          });
                      }}
                    >{recallStatus === "evaluating" ? "正在判断…" : "提交我的理解"}</button>
                  </>
                ) : (
                  <div className={`recall-result recall-result--${recallEvaluation.verdict}`}>
                    <strong>{verdictLabel(recallEvaluation.verdict)}</strong>
                    <p>{recallEvaluation.feedback}</p>
                    <p>{recallEvaluation.contextualMeaning}</p>
                    {recallEvaluation.missingPoints.length > 0 && (
                      <ul>{recallEvaluation.missingPoints.map((point) => <li key={point}>{point}</li>)}</ul>
                    )}
                  </div>
                )}
              </>
            )}
          </aside>
        )}
      </section>
    </main>
  );
}

function verdictLabel(verdict: RecallEvaluation["verdict"]): string {
  if (verdict === "understood") return "理解准确";
  if (verdict === "partially_understood") return "部分理解";
  return "需要再留意";
}

function readSelectionCandidate(root: HTMLElement | null) {
  const selection = window.getSelection();
  if (root === null || selection === null || selection.rangeCount !== 1 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const startBlock = closestBlock(range.startContainer);
  const endBlock = closestBlock(range.endContainer);
  if (startBlock === null || endBlock === null || startBlock !== endBlock) return null;
  const blockId = startBlock.dataset.blockId;
  if (blockId === undefined) return null;

  const prefix = document.createRange();
  prefix.selectNodeContents(startBlock);
  prefix.setEnd(range.startContainer, range.startOffset);
  const startOffset = prefix.toString().length;
  const selectedText = range.toString();
  if (selectedText.trim().length === 0) return null;
  return {
    start: { blockId, offset: startOffset },
    end: { blockId, offset: startOffset + selectedText.length },
    selectedText,
  };
}

function closestBlock(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return element?.closest<HTMLElement>("[data-block-id]") ?? null;
}

function navigateToBlock(blockId: string, behavior: ScrollBehavior): void {
  const escaped = CSS.escape(blockId);
  document.querySelector<HTMLElement>(`[data-block-id="${escaped}"]`)?.scrollIntoView({
    behavior,
    block: "start",
  });
}
