import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { LoaderCircle, MessageCircleMore, Quote, Send, X } from "lucide-react";
import type {
  ConversationIntent,
  ConversationReference,
  ConversationReferenceInput,
  ReadingConversation,
  WorkspaceReference,
  WorkspaceReferenceInput,
} from "@lumen/api-contract";

import { AppIcon } from "../app/AppIcon";
import { Button, IconButton, ScrollArea, TextField } from "../app/ui";
import type { SelectionCandidate } from "../document-renderers/renderer-contract";
import { SafeMarkdown } from "./SafeMarkdown";

export interface PendingConversationReference {
  key: string;
  label: string;
  input: ConversationReferenceInput;
}

/** @deprecated 仅供旧 Workspace 调试通道在迁移期读取。 */
export interface PendingWorkspaceReference {
  key: string;
  label: string;
  input: WorkspaceReferenceInput;
  navigation?: Pick<WorkspaceReference, "revisionId" | "start" | "end" | "label">;
}

export function WorkspacePanel({
  conversation,
  currentSelection,
  error,
  onAsk,
  onClearSelection,
  onClose,
  onNavigateReference,
  onReferenceTurn,
  onRemoveReference,
  overlayRef,
  pendingReferences,
  status,
}: {
  conversation: ReadingConversation | null;
  currentSelection: SelectionCandidate | null;
  error: string | null;
  onAsk(question: string, intentHint?: ConversationIntent): void;
  onClearSelection(): void;
  onClose(): void;
  onNavigateReference(reference: ConversationReference): void;
  onReferenceTurn(turnId: string, question: string): void;
  onRemoveReference(key: string): void;
  overlayRef: MutableRefObject<HTMLElement | null>;
  pendingReferences: PendingConversationReference[];
  status: "idle" | "opening" | "asking" | "error";
}) {
  const [question, setQuestion] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const canExplain = currentSelection !== null && pendingReferences.length === 0;
  const canSubmit = status !== "asking"
    && conversation !== null
    && (question.trim().length > 0 || canExplain);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [conversation?.turns.length, status]);

  const submit = (intentHint?: ConversationIntent) => {
    if (!canSubmit) return;
    onAsk(question.trim(), intentHint);
    setQuestion("");
  };

  return (
    <aside
      aria-label="AI 阅读助手"
      className="workspace-panel conversation-panel"
      data-reader-overlay
      ref={overlayRef}
      tabIndex={-1}
    >
      <header className="workspace-header">
        <div>
          <strong><AppIcon icon={MessageCircleMore} size={17} />AI 阅读助手</strong>
          <small>{conversation?.sceneId === "technical_learning" ? "技术学习" : "英文阅读"} · 引用原文后提问</small>
        </div>
        <IconButton label="关闭 AI 阅读助手" onClick={onClose}><AppIcon icon={X} size={16} /></IconButton>
      </header>

      <ScrollArea axis="y" className="workspace-body conversation-body">
        {status === "opening" && <p className="workspace-message">正在恢复本地对话与 AI 注脚…</p>}
        {conversation?.turns.length === 0 && status !== "opening" && (
          <p className="workspace-message">选中原文可直接解释，也可以输入问题进行知识问答。</p>
        )}
        {conversation?.turns.map((turn) => (
          <article className="workspace-turn conversation-turn" key={turn.turnId}>
            <p className="workspace-question">{turn.question || `解释“${turn.references[0]?.label.replace(/^选区：/u, "") ?? "选中内容"}”`}</p>
            {turn.references.length > 0 && (
              <div className="workspace-turn-references">
                {turn.references.map((reference) => <span key={reference.referenceId}>{reference.label}</span>)}
              </div>
            )}
            <SafeMarkdown
              content={turn.answer.content}
              references={turn.references}
              onReference={onNavigateReference}
            />
            <footer>
              <small>
                {turn.answer.knowledgeBoundary === "document_grounded" && "仅依据引用内容"}
                {turn.answer.knowledgeBoundary === "mixed" && "引用内容 + 通用知识"}
                {turn.answer.knowledgeBoundary === "model_knowledge" && "通用知识回答"}
                {turn.footnote !== null && " · 已生成 AI 注脚"}
              </small>
              <IconButton label="引用本轮对话" onClick={() => onReferenceTurn(turn.turnId, turn.question)}>
                <AppIcon icon={Quote} size={14} />
              </IconButton>
            </footer>
          </article>
        ))}
        <div ref={endRef} />
      </ScrollArea>

      <section className="workspace-composer conversation-composer">
        {currentSelection !== null && (
          <div className="conversation-reference-chip">
            <span><AppIcon icon={Quote} size={13} />{currentSelection.selectedText}</span>
            <IconButton label="移除当前选区引用" onClick={onClearSelection}><AppIcon icon={X} size={12} /></IconButton>
          </div>
        )}
        {pendingReferences.map((reference) => (
          <div className="conversation-reference-chip" key={reference.key}>
            <span><AppIcon icon={Quote} size={13} />{reference.label}</span>
            <IconButton label={`移除 ${reference.label}`} onClick={() => onRemoveReference(reference.key)}><AppIcon icon={X} size={12} /></IconButton>
          </div>
        ))}
        <TextField
          fullWidth
          multiline
          minRows={2}
          maxRows={6}
          placeholder={canExplain ? "留空直接解释，或输入你的具体问题" : "询问当前材料或相关技术知识"}
          slotProps={{ htmlInput: { maxLength: 4000 } }}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            submit();
          }}
        />
        <div className="conversation-actions">
          {canExplain && (
            <Button type="button" variant="secondary" disabled={status === "asking"} onClick={() => submit("explain")}>解释选中内容</Button>
          )}
          <Button type="button" disabled={!canSubmit} onClick={() => submit()}>
            <AppIcon className={status === "asking" ? "is-spinning" : undefined} icon={status === "asking" ? LoaderCircle : Send} size={16} />
            {status === "asking" ? "正在回答…" : "发送"}
          </Button>
        </div>
        {error !== null && <p className="lens-error">{error}</p>}
      </section>
    </aside>
  );
}
