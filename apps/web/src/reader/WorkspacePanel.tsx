import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  LoaderCircle,
  Maximize2,
  MessageCircleMore,
  Minimize2,
  Plus,
  Quote,
  Send,
  X,
} from "lucide-react";
import type {
  WorkspaceReferenceInput,
  WorkspaceReference,
  WorkspaceSession,
  WorkspaceSessionSummary,
} from "@lumen/api-contract";

import { AppIcon } from "../app/AppIcon";
import { Button, IconButton, ScrollArea, TextField } from "../app/ui";
import { SafeMarkdown } from "./SafeMarkdown";

export interface PendingWorkspaceReference {
  key: string;
  label: string;
  input: WorkspaceReferenceInput;
  navigation?: Pick<WorkspaceReference, "revisionId" | "start" | "end" | "label">;
}

export function WorkspacePanel({
  error,
  onAsk,
  onClose,
  onReferenceTurn,
  onNavigateReference,
  onNavigatePendingReference,
  onRemoveReference,
  onCreateSession,
  onSwitchSession,
  onToggleReferenceMode,
  overlayRef,
  pendingReferences,
  sessions,
  session,
  status,
  canReferenceDocument,
  referenceMode,
  referenceTargetKind,
}: {
  error: string | null;
  onAsk(question: string): void;
  onClose(): void;
  onReferenceTurn(turnId: string, question: string): void;
  onNavigateReference(reference: WorkspaceReference): void;
  onNavigatePendingReference(reference: NonNullable<PendingWorkspaceReference["navigation"]>): void;
  onRemoveReference(key: string): void;
  onCreateSession(): void;
  onSwitchSession(sessionId: string): void;
  onToggleReferenceMode(): void;
  overlayRef: MutableRefObject<HTMLElement | null>;
  pendingReferences: PendingWorkspaceReference[];
  sessions: WorkspaceSessionSummary[];
  session: WorkspaceSession | null;
  status: "idle" | "opening" | "asking" | "error";
  canReferenceDocument: boolean;
  referenceMode: boolean;
  referenceTargetKind: "word" | "sentence" | "block" | null;
}) {
  const [question, setQuestion] = useState("");
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState(() => ({
    x: Math.max(16, window.innerWidth - 460),
    y: 108,
  }));
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag === null || event.pointerId !== drag.pointerId) return;
      setPosition({
        x: Math.min(Math.max(8, event.clientX - drag.offsetX), Math.max(8, window.innerWidth - 72)),
        y: Math.min(Math.max(8, event.clientY - drag.offsetY), Math.max(8, window.innerHeight - 48)),
      });
    };
    const stop = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, []);

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as Element).closest("button")) return;
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (bounds === undefined) return;
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  return (
    <aside
      className={`workspace-panel${minimized ? " is-minimized" : ""}`}
      ref={overlayRef}
      data-reader-overlay
      tabIndex={-1}
      aria-label="AI 工作区"
      style={{ left: position.x, top: position.y }}
    >
      <header className="workspace-header" onPointerDown={startDrag}>
        <div>
          <strong><AppIcon icon={MessageCircleMore} size={16} />AI 工作区</strong>
          {!minimized && <small>基于当前文档辅助理解，每轮问答相互独立</small>}
        </div>
        <nav aria-label="工作区窗口操作">
          <IconButton label={minimized ? "展开工作区" : "最小化工作区"} onClick={() => setMinimized(!minimized)}>
            <AppIcon icon={minimized ? Maximize2 : Minimize2} size={15} />
          </IconButton>
          <IconButton label="关闭工作区" onClick={onClose}><AppIcon icon={X} size={15} /></IconButton>
        </nav>
      </header>
      {!minimized && (
        <ScrollArea axis="y" className="workspace-body">
          <div className="workspace-session-controls">
            <label htmlFor="workspace-session">会话</label>
            <select
              id="workspace-session"
              disabled={status === "opening" || status === "asking" || session === null}
              value={session?.sessionId ?? ""}
              onChange={(event) => {
                if (question.trim().length > 0 && !window.confirm("切换会话会清空未发送的问题，是否继续？")) return;
                setQuestion("");
                onSwitchSession(event.target.value);
              }}
            >
              {sessions.map((item) => (
                <option key={item.sessionId} value={item.sessionId}>{item.title}</option>
              ))}
            </select>
            <IconButton
              label="新建会话"
              disabled={status === "opening" || status === "asking"}
              onClick={() => {
                if (question.trim().length > 0 && !window.confirm("新建会话会清空未发送的问题，是否继续？")) return;
                setQuestion("");
                onCreateSession();
              }}
            ><AppIcon icon={Plus} size={14} /></IconButton>
          </div>
          {status === "opening" && <p className="workspace-message">正在恢复本地会话…</p>}
          {session !== null && session.turns.length === 0 && (
            <p className="workspace-message">可以直接基于当前文档提问；显式引用用于强调你关注的原文或已有材料。</p>
          )}
          {session?.turns.map((turn) => (
            <article className="workspace-turn" key={turn.turnId}>
              <p className="workspace-question">{turn.question}</p>
              <div className="workspace-turn-references">
                {turn.references.map((reference) => <span key={reference.referenceId}>{reference.label}</span>)}
              </div>
              <SafeMarkdown
                content={turn.answer.content}
                references={[...turn.references, ...turn.contextReferences]}
                onReference={onNavigateReference}
              />
              {turn.answer.outcome === "insufficient_evidence" && (
                <p className="workspace-outcome">当前文档证据不足</p>
              )}
              <div className="workspace-citations" aria-label="回答来源">
                {[...turn.references, ...turn.contextReferences]
                  .filter((reference) => turn.answer.citationReferenceIds.includes(reference.referenceId))
                  .map((reference) => (
                    <Button
                      key={reference.referenceId}
                      type="button"
                      variant="ghost"
                      onClick={() => onNavigateReference(reference)}
                    >{reference.label}</Button>
                  ))}
              </div>
              <small className="workspace-context-stats">
                {turn.answer.contextMode === "full_document" && "全文上下文"}
                {turn.answer.contextMode === "retrieved_document" && "文档检索上下文"}
                {turn.answer.contextMode === "explicit_references_only" && "仅显式引用"}
                {` · ${turn.answer.contextStats.includedCharacterCount} 字符`}
                {turn.answer.contextStats.truncated && " · 已按上下文预算裁剪"}
              </small>
              <IconButton label="引用本轮回答" onClick={() => onReferenceTurn(turn.turnId, turn.question)}>
                <AppIcon icon={Quote} size={14} />
              </IconButton>
            </article>
          ))}
          <section className="workspace-composer">
            <div className="workspace-source-actions">
              <Button
                aria-pressed={referenceMode}
                className={referenceMode ? "is-active" : undefined}
                type="button"
                variant="secondary"
                disabled={!canReferenceDocument}
                onClick={onToggleReferenceMode}
              >
                <AppIcon icon={Quote} size={14} />
                {referenceMode ? "退出原文引用" : "从原文引用"}
              </Button>
              {referenceMode && (
                <small role="status">
                  {referenceTargetKind === "word" && "当前将引用单词"}
                  {referenceTargetKind === "sentence" && "当前将引用句子"}
                  {referenceTargetKind === "block" && "当前将引用段落块"}
                  {referenceTargetKind === null && "悬停原文；右键或 Esc 退出"}
                </small>
              )}
            </div>
            <div className="workspace-pending" aria-label="本轮引用">
              <strong>本轮 References</strong>
              {pendingReferences.length === 0 ? (
                <p>未添加显式引用，将由当前文档提供知识上下文。</p>
              ) : pendingReferences.map((reference) => (
                <span key={reference.key}>
                  {reference.navigation === undefined ? reference.label : (
                    <button
                      className="workspace-pending-reference"
                      type="button"
                      onClick={() => onNavigatePendingReference(reference.navigation!)}
                    >{reference.label}</button>
                  )}
                  <IconButton label={`移除 ${reference.label}`} onClick={() => onRemoveReference(reference.key)}>
                    <AppIcon icon={X} size={12} />
                  </IconButton>
                </span>
              ))}
            </div>
            <label htmlFor="workspace-question">询问当前文档</label>
            <TextField
              fullWidth
              multiline
              id="workspace-question"
              rows={3}
              slotProps={{ htmlInput: { maxLength: 4000 } }}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <Button
              className="workspace-send"
              type="button"
              disabled={status === "asking" || session === null || question.trim().length === 0}
              onClick={() => {
                onAsk(question.trim());
                setQuestion("");
              }}
            >
              <AppIcon className={status === "asking" ? "is-spinning" : undefined} icon={status === "asking" ? LoaderCircle : Send} size={16} />
              {status === "asking" ? "正在回答…" : "发送问题"}
            </Button>
            {error !== null && <p className="lens-error">{error}</p>}
          </section>
        </ScrollArea>
      )}
    </aside>
  );
}
