import { useEffect, useState } from "react";
import {
  Archive,
  ArrowLeft,
  BookOpen,
  GitBranch,
  Layers3,
  LocateFixed,
  MessagesSquare,
  Pencil,
  Save,
  Volume2,
} from "lucide-react";
import { Link, useParams } from "react-router";

import type {
  ExpressionStatus,
  LearningContextDetail,
  LearningContextSort,
  LearningExpressionDetail,
} from "@lumen/api-contract";

import {
  archiveLearningContext,
  getLearningExpression,
  updateLearningContextNote,
  updateLearningExpressionNote,
  updateLearningExpressionStatus,
} from "../api/learning";
import { AppIcon } from "../app/AppIcon";
import { AppShell } from "../app/AppShell";
import { Button, MenuItem, Select, TextField } from "../app/ui";
import "./learning-library.css";

export function ExpressionDetailPage() {
  const { expressionId = "" } = useParams();
  const [detail, setDetail] = useState<LearningExpressionDetail | null>(null);
  const [contextSort, setContextSort] = useState<LearningContextSort>("newest");
  const [expressionNote, setExpressionNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void getLearningExpression(
      expressionId,
      contextSort,
      (input, init) => fetch(input, { ...init, signal: controller.signal }),
    )
      .then((loaded) => {
        setDetail(loaded);
        setExpressionNote(loaded.userNote);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "无法加载表达档案");
        }
      });
    return () => controller.abort();
  }, [contextSort, expressionId]);

  const runAction = async (
    key: string,
    action: () => Promise<LearningExpressionDetail>,
  ) => {
    setPendingAction(key);
    setError(null);
    try {
      const updated = await action();
      setDetail({ ...updated, contexts: sortContexts(updated.contexts, contextSort) });
      setExpressionNote(updated.userNote);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "表达档案更新失败");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <AppShell
      activeSection="learning"
      quickSearchLabel="返回表达检索"
      onQuickSearch={() => window.location.assign("/learning")}
      workspaceLabel="Expression Archive"
    >
      <main className="expression-detail-page">
        <Link className="expression-detail-back" to="/learning"><AppIcon icon={ArrowLeft} size={16} />返回表达收藏</Link>

        {error !== null && <div className="learning-state learning-state--error"><h2>表达档案暂时不可用</h2><p>{error}</p></div>}
        {error === null && detail === null && <div className="learning-state"><p>正在载入表达档案…</p></div>}
        {detail !== null && (
          <>
            <header className="expression-detail-header">
              <div>
                <p className="library-kicker">Expression Archive <span /> {detail.expressionType}</p>
                <div className="expression-detail-title">
                  <h1>{detail.canonicalForm}</h1>
                  <Button type="button" variant="ghost" disabled title="暂无可靠音频"><AppIcon icon={Volume2} size={16} />发音</Button>
                </div>
                <p className="expression-detail-pronunciation">
                  {detail.lexicalProfile?.pronunciations.find((item) => item.system === "ipa")?.value ?? "暂无可靠音标"}
                  {detail.lexicalProfile === null ? "" : ` · ${detail.lexicalProfile.partsOfSpeech.map((item) => item.partOfSpeech).join(" / ")}`}
                </p>
                <p className="expression-detail-meaning">{stableMeaning(detail)}</p>
              </div>
              <label className="expression-status-control">
                <span>学习状态</span>
                <Select
                  aria-label="学习状态"
                  size="small"
                  value={detail.status}
                  disabled={pendingAction !== null}
                  onChange={(event) => void runAction(
                    "status",
                    () => updateLearningExpressionStatus(expressionId, event.target.value as ExpressionStatus),
                  )}
                >
                  <MenuItem value="active">学习中</MenuItem>
                  <MenuItem value="familiar">已熟悉</MenuItem>
                  <MenuItem value="archived">已归档</MenuItem>
                </Select>
              </label>
            </header>

            <div className="expression-detail-layout">
              <section className="expression-detail-knowledge" aria-label="稳定表达知识">
                <KnowledgeSections detail={detail} />
                <section className="expression-note-panel">
                  <h2><AppIcon icon={Pencil} size={18} />通用研读笔记</h2>
                  <p>这部分完全由你维护，词汇资料刷新不会覆盖。</p>
                  <TextField
                    fullWidth
                    multiline
                    value={expressionNote}
                    slotProps={{ htmlInput: { maxLength: 10_000 } }}
                    rows={7}
                    placeholder="记录辨析、记忆线索或自己的理解…"
                    onChange={(event) => setExpressionNote(event.target.value)}
                  />
                  <Button
                    type="button"
                    disabled={pendingAction !== null || expressionNote === detail.userNote}
                    onClick={() => void runAction(
                      "expression-note",
                      () => updateLearningExpressionNote(expressionId, expressionNote),
                    )}
                  >
                    <AppIcon icon={Save} size={15} />
                    {pendingAction === "expression-note" ? "正在保存…" : "保存表达笔记"}
                  </Button>
                </section>
              </section>

              <section className="expression-contexts" aria-labelledby="expression-contexts-title">
                <header>
                  <div>
                    <p className="library-kicker">Context History</p>
                    <h2 id="expression-contexts-title"><AppIcon icon={Layers3} size={18} />真实语境 · {detail.contexts.length}</h2>
                  </div>
                  <Select
                    size="small"
                    aria-label="语境排序"
                    value={contextSort}
                    onChange={(event) => setContextSort(event.target.value as LearningContextSort)}
                  >
                    <MenuItem value="newest">最新在前</MenuItem>
                    <MenuItem value="oldest">最早在前</MenuItem>
                  </Select>
                </header>
                {detail.contexts.length === 0 && <div className="expression-context-empty">当前没有历史语境。</div>}
                {detail.contexts.map((context) => (
                  <ContextCard
                    context={context}
                    expressionId={expressionId}
                    isPending={pendingAction !== null}
                    key={context.learningContextId}
                    onAction={runAction}
                  />
                ))}
              </section>
            </div>
          </>
        )}
      </main>
    </AppShell>
  );
}

function KnowledgeSections({ detail }: { detail: LearningExpressionDetail }) {
  const profile = detail.lexicalProfile;
  const localization = detail.lexicalLocalization;
  if (profile === null) {
    return (
      <section className="expression-knowledge-section">
        <h2><AppIcon icon={BookOpen} size={18} />稳定词汇资料</h2>
        <p>本机尚未缓存可匹配的 Wiktionary 资料；历史语境仍可完整查看。</p>
      </section>
    );
  }
  return (
    <>
      <section className="expression-knowledge-section">
        <h2><AppIcon icon={BookOpen} size={18} />常见释义</h2>
        {profile.partsOfSpeech.map((part) => (
          <div className="expression-sense-group" key={part.partOfSpeech}>
            <h3>{part.partOfSpeech}</h3>
            <ol>
              {part.senses.map((sense) => {
                const localized = localization?.senses.find((item) => item.sourceGloss === sense.gloss);
                return (
                  <li key={sense.gloss}>
                    <strong>{localized?.chineseGloss ?? sense.gloss}</strong>
                    {localized !== undefined && <span>{sense.gloss}</span>}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </section>
      <section className="expression-knowledge-section">
        <h2><AppIcon icon={MessagesSquare} size={18} />语用与搭配</h2>
        {profile.partsOfSpeech.flatMap((part) => part.senses).every((sense) => sense.usageLabels.length === 0 && sense.examples.length === 0)
          ? <p>来源中暂无结构化用法或例句。</p>
          : profile.partsOfSpeech.flatMap((part) => part.senses).map((sense) => (
            <div className="expression-usage" key={sense.gloss}>
              {sense.usageLabels.length > 0 && <p>{sense.usageLabels.join(" · ")}</p>}
              {sense.examples.map((example) => <blockquote key={example}>{example}</blockquote>)}
            </div>
          ))}
      </section>
      <section className="expression-knowledge-section">
        <h2><AppIcon icon={GitBranch} size={18} />构词与词族</h2>
        <p>{localization?.etymologySummary || profile.etymology || "来源中暂无结构化构词说明。"}</p>
        {profile.derivedTerms.length > 0 && <p><strong>派生：</strong>{profile.derivedTerms.join("、")}</p>}
        {profile.relatedTerms.length > 0 && <p><strong>相关：</strong>{profile.relatedTerms.join("、")}</p>}
      </section>
    </>
  );
}

function ContextCard({
  context,
  expressionId,
  isPending,
  onAction,
}: {
  context: LearningContextDetail;
  expressionId: string;
  isPending: boolean;
  onAction: (key: string, action: () => Promise<LearningExpressionDetail>) => Promise<void>;
}) {
  const [note, setNote] = useState(context.userNote);
  useEffect(() => setNote(context.userNote), [context.userNote]);
  const key = `context-${context.learningContextId}`;
  const readerQuery = new URLSearchParams({
    revisionId: context.revisionId,
    block: context.startBlockId,
    startOffset: String(context.startOffset),
    endBlock: context.endBlockId,
    endOffset: String(context.endOffset),
  });
  return (
    <article className={`expression-context-card${context.status === "archived" ? " is-archived" : ""}`}>
      <header>
        <div>
          <h3>{context.documentTitle}</h3>
          <p>{context.locationLabel} · {formatDateTime(context.createdAt)}</p>
        </div>
        <span>{context.status === "archived" ? "已归档" : "有效语境"}</span>
      </header>
      <blockquote>{highlightSurface(context.surroundingContext, context.surfaceForm)}</blockquote>
      <dl>
        <div><dt>当时翻译</dt><dd>{context.contextualTranslation}</dd></div>
        <div><dt>当时解释</dt><dd>{context.explanation || context.contextualMeaning}</dd></div>
        {context.uncertainty.length > 0 && <div><dt>不确定性</dt><dd>{context.uncertainty}</dd></div>}
      </dl>
      <label>
        <span>语境笔记</span>
        <TextField
          fullWidth
          multiline
          rows={3}
          slotProps={{ htmlInput: { maxLength: 10_000 } }}
          value={note}
          placeholder="记录只属于这次阅读的观察…"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="expression-context-actions">
        <Button
          type="button"
          disabled={isPending || note === context.userNote}
          onClick={() => void onAction(
            key,
            () => updateLearningContextNote(expressionId, context.learningContextId, note),
          )}
        >
          <AppIcon icon={Save} size={15} />
          保存语境笔记
        </Button>
        <Link to={`/reader/${context.documentId}?${readerQuery.toString()}`}><AppIcon icon={LocateFixed} size={15} />回到精确原文</Link>
        {context.status === "active" && (
          <Button
            className="expression-context-archive"
            type="button"
            disabled={isPending}
            onClick={() => {
              if (window.confirm("归档后仍会保留历史翻译与操作记录。确认归档这条语境吗？")) {
                void onAction(
                  `${key}-archive`,
                  () => archiveLearningContext(expressionId, context.learningContextId),
                );
              }
            }}
          >
            <AppIcon icon={Archive} size={15} />
            归档语境
          </Button>
        )}
      </div>
    </article>
  );
}

function stableMeaning(detail: LearningExpressionDetail): string {
  return detail.lexicalLocalization?.senses[0]?.chineseGloss
    ?? detail.lexicalProfile?.partsOfSpeech[0]?.senses[0]?.gloss
    ?? detail.contexts.find((context) => context.status === "active")?.contextualMeaning
    ?? "暂无稳定释义";
}

function highlightSurface(context: string, surface: string) {
  const index = context.toLocaleLowerCase().indexOf(surface.toLocaleLowerCase());
  if (index < 0) return context;
  return (
    <>
      {context.slice(0, index)}
      <mark>{context.slice(index, index + surface.length)}</mark>
      {context.slice(index + surface.length)}
    </>
  );
}

function sortContexts(contexts: LearningContextDetail[], sort: LearningContextSort) {
  return contexts.toSorted((left, right) => {
    const difference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    return sort === "oldest" ? difference : -difference;
  });
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
