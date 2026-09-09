import { useEffect, useState } from "react";
import {
  ArrowRight,
  Clock3,
  Languages,
  Layers3,
  LoaderCircle,
  Quote,
  Search,
  Volume2,
  X,
} from "lucide-react";
import { Link } from "react-router";

import type {
  DocumentSummary,
  ExpressionStatus,
  ExpressionType,
  LearningExpressionList,
  LearningExpressionSummary,
  LearningListSort,
} from "@lumen/api-contract";

import { getLearningItems } from "../api/learning";
import { getDocuments } from "../api/library";
import { AppIcon } from "../app/AppIcon";
import { AppShell } from "../app/AppShell";
import { Button, IconButton, InputBase, MenuItem, Select } from "../app/ui";
import "./learning-library.css";

const emptyResult: LearningExpressionList = {
  items: [],
  nextCursor: null,
  totalExpressions: 0,
  totalContexts: 0,
};

export function LearningLibraryPage() {
  const [result, setResult] = useState<LearningExpressionList>(emptyResult);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [expressionType, setExpressionType] = useState<ExpressionType | "">("");
  const [status, setStatus] = useState<ExpressionStatus | "">("");
  const [sourceDocumentId, setSourceDocumentId] = useState("");
  const [sort, setSort] = useState<LearningListSort>("updated_desc");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    void getDocuments((input, init) => fetch(input, { ...init, signal: controller.signal }))
      .then(setDocuments)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    void getLearningItems({
      query: debouncedQuery,
      expressionType: expressionType || undefined,
      status: status || undefined,
      sourceDocumentId: sourceDocumentId || undefined,
      sort,
      limit: 12,
    }, (input, init) => fetch(input, { ...init, signal: controller.signal }))
      .then(setResult)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "无法加载表达收藏");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [debouncedQuery, expressionType, sourceDocumentId, sort, status]);

  const loadMore = async () => {
    if (result.nextCursor === null || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const next = await getLearningItems({
        query: debouncedQuery,
        expressionType: expressionType || undefined,
        status: status || undefined,
        sourceDocumentId: sourceDocumentId || undefined,
        sort,
        cursor: result.nextCursor,
        limit: 12,
      });
      setResult((current) => ({
        ...next,
        items: [...current.items, ...next.items],
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法继续加载表达");
    } finally {
      setIsLoadingMore(false);
    }
  };

  const clearFilters = () => {
    setQuery("");
    setExpressionType("");
    setStatus("");
    setSourceDocumentId("");
  };

  return (
    <AppShell
      activeSection="learning"
      onQuickSearch={() => document.querySelector<HTMLInputElement>("#expression-search")?.focus()}
      quickSearchLabel="快速检索表达"
      workspaceLabel="Learning Library"
    >
      <div className="learning-page-content">
        <header className="learning-heading">
          <div>
            <p className="library-kicker">Corpus Repository <span /> Lumen Lexicon Archive</p>
            <h1>表达收藏</h1>
            <p>在真实阅读语境中积累、研读并持续整理表达。</p>
          </div>
          <div className="learning-stats">
            <span><AppIcon icon={Languages} size={15} />关联表达 <strong>{result.totalExpressions}</strong></span>
            <span><AppIcon icon={Layers3} size={15} />真实语境 <strong>{result.totalContexts}</strong></span>
          </div>
        </header>

        <div className="learning-toolbar">
          <label className="learning-search">
            <AppIcon icon={Search} size={16} />
            <InputBase
              id="expression-search"
              type="search"
              value={query}
              placeholder="搜索表达、变体、笔记或语境…"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query.length > 0 && (
              <IconButton label="清空搜索" onClick={() => setQuery("")}>
                <AppIcon icon={X} size={15} />
              </IconButton>
            )}
          </label>
          <Select size="small" aria-label="表达排序" value={sort} onChange={(event) => setSort(event.target.value as LearningListSort)}>
            <MenuItem value="updated_desc">按最近更新</MenuItem>
            <MenuItem value="canonical_asc">按字母排序</MenuItem>
            <MenuItem value="context_count_desc">按语境数量</MenuItem>
          </Select>
        </div>

        <div className="learning-query-filters" aria-label="表达筛选">
          <Select size="small" aria-label="表达类型" value={expressionType} onChange={(event) => setExpressionType(event.target.value as ExpressionType | "")}>
            <MenuItem value="">全部类型</MenuItem>
            <MenuItem value="word">单词</MenuItem>
            <MenuItem value="phrase">短语</MenuItem>
            <MenuItem value="collocation">搭配</MenuItem>
            <MenuItem value="sentence">句子</MenuItem>
          </Select>
          <Select size="small" aria-label="学习状态" value={status} onChange={(event) => setStatus(event.target.value as ExpressionStatus | "")}>
            <MenuItem value="">进行中与已熟悉</MenuItem>
            <MenuItem value="active">学习中</MenuItem>
            <MenuItem value="familiar">已熟悉</MenuItem>
            <MenuItem value="archived">已归档</MenuItem>
          </Select>
          <Select size="small" aria-label="来源文档" value={sourceDocumentId} onChange={(event) => setSourceDocumentId(event.target.value)}>
            <MenuItem value="">全部来源</MenuItem>
            {documents.map((document) => (
              <MenuItem value={document.documentId} key={document.documentId}>{document.title}</MenuItem>
            ))}
          </Select>
          <Button type="button" variant="secondary" onClick={clearFilters}><AppIcon icon={X} size={15} />清除筛选</Button>
        </div>

        {error !== null && (
          <div className="learning-state learning-state--error">
            <h2>表达收藏暂时无法加载</h2><p>{error}</p>
          </div>
        )}
        {error === null && isLoading && (
          <div className="learning-state"><p>正在整理表达与语境…</p></div>
        )}
        {error === null && !isLoading && result.totalExpressions === 0 && (
          debouncedQuery || expressionType || status || sourceDocumentId
            ? <LearningSearchEmpty onClear={clearFilters} />
            : <LearningEmpty />
        )}
        {error === null && !isLoading && result.items.length > 0 && (
          <>
            <section className="expression-grid" aria-label="表达收藏列表">
              {result.items.map((item) => <ExpressionCard item={item} key={item.expressionId} />)}
            </section>
            {result.nextCursor !== null && (
              <div className="learning-load-more">
                <Button type="button" disabled={isLoadingMore} onClick={() => void loadMore()}>
                  {isLoadingMore && <AppIcon className="is-spinning" icon={LoaderCircle} size={16} />}
                  {isLoadingMore ? "正在加载…" : "加载更多"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function ExpressionCard({ item }: { item: LearningExpressionSummary }) {
  return (
    <article className="expression-card">
      <header>
        <div>
          <h2>{item.canonicalForm}</h2>
          <IconButton label={item.audioUrl === null ? "暂无可靠音频" : "播放发音"} disabled={item.audioUrl === null}>
            <AppIcon icon={Volume2} size={16} />
          </IconButton>
        </div>
        <span className={`expression-badge expression-badge--${item.status}`}>{statusLabel(item.status)}</span>
      </header>
      <p className="expression-kind">
        {typeLabel(item.expressionType)}
        {item.pronunciation === null ? "" : ` · ${item.pronunciation}`}
        {item.partsOfSpeech.length === 0 ? "" : ` · ${item.partsOfSpeech.join(" / ")}`}
      </p>
      <h3>{item.stableMeaning ?? item.latestContext?.contextualTranslation ?? "稳定词汇资料尚未缓存"}</h3>
      {item.latestContext === null ? (
        <blockquote><p>当前没有未归档语境。</p></blockquote>
      ) : (
        <blockquote>
          <p>“{item.latestContext.surroundingContext}”</p>
          <small>{item.latestContext.documentTitle} · {item.latestContext.contextualMeaning}</small>
        </blockquote>
      )}
      <div className="expression-card-meta">
        <span><AppIcon icon={Layers3} size={14} />{item.contextCount} 个真实语境</span>
        <span><AppIcon icon={Clock3} size={14} />{formatDate(item.updatedAt)}</span>
      </div>
      <Link to={`/learning/${item.expressionId}`}>打开表达档案 <AppIcon icon={ArrowRight} size={16} /></Link>
    </article>
  );
}

function LearningEmpty() {
  return (
    <div className="learning-state">
      <span><AppIcon icon={Quote} size={38} /></span><p className="library-kicker">Empty Lexicon</p><h2>还没有收藏表达</h2>
      <p>阅读时划选值得积累的英文表达，获得语境翻译后即可收藏到这里。</p>
      <Link to="/">选择一篇材料开始阅读</Link>
    </div>
  );
}

function LearningSearchEmpty({ onClear }: { onClear: () => void }) {
  return (
    <div className="learning-state">
      <span><AppIcon icon={Search} size={38} /></span><h2>没有找到相关表达</h2>
      <p>搜索会覆盖标准形式、观察到的变体、用户笔记和历史语境。</p>
      <Button type="button" variant="secondary" onClick={onClear}><AppIcon icon={X} size={15} />清除筛选</Button>
    </div>
  );
}

function typeLabel(type: ExpressionType): string {
  return ({ word: "单词", phrase: "短语", collocation: "搭配", sentence: "句子" })[type];
}

function statusLabel(status: ExpressionStatus): string {
  return ({ active: "学习中", familiar: "已熟悉", archived: "已归档" })[status];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" })
    .format(new Date(value));
}
