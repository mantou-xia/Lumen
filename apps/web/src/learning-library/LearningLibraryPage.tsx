import { useEffect, useState } from "react";
import { Link } from "react-router";

import type { LearningItem } from "@lumen/api-contract";

import { getLearningItems } from "../api/learning";

export function LearningLibraryPage() {
  const [items, setItems] = useState<LearningItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getLearningItems().then(setItems).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "无法加载表达收藏");
    });
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar compact-topbar">
        <div>
          <p className="eyebrow">Learning Library</p>
          <h1>表达收藏</h1>
        </div>
        <Link className="back-link" to="/">← 返回文档库</Link>
      </header>
      <section className="learning-list">
        {error !== null && <p className="notice notice--error">{error}</p>}
        {items.length === 0 && error === null ? (
          <div className="empty-library">
            <p className="empty-mark">“ ”</p>
            <h3>还没有收藏表达</h3>
            <p>阅读时划选英文，获得翻译后即可收藏当前真实语境。</p>
          </div>
        ) : items.map((item) => (
          <article className="learning-card" key={item.expressionId}>
            <div className="learning-card-heading">
              <div>
                <span>{item.expressionType}</span>
                <h2>{item.canonicalForm}</h2>
              </div>
              <strong>{item.contexts.length} 个语境</strong>
            </div>
            {item.contexts.map((context) => (
              <div className="learning-context" key={context.learningContextId}>
                <p>{context.surroundingContext}</p>
                <h3>{context.contextualTranslation}</h3>
                <p className="context-meaning">{context.contextualMeaning}</p>
                <Link to={`/reader/${context.documentId}?block=${encodeURIComponent(context.startBlockId)}`}>
                  回到原文位置 →
                </Link>
              </div>
            ))}
          </article>
        ))}
      </section>
    </main>
  );
}
