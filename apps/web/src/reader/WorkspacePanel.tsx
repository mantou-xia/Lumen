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
  Pilcrow,
  Quote,
  Send,
  TextSelect,
  X,
} from "lucide-react";
import type {
  WorkspaceReferenceInput,
  WorkspaceSession,
} from "@lumen/api-contract";

import { AppIcon } from "../app/AppIcon";

export interface PendingWorkspaceReference {
  key: string;
  label: string;
  input: WorkspaceReferenceInput;
}

export function WorkspacePanel({
  error,
  onAddParagraph,
  onAddSelection,
  onAsk,
  onClose,
  onReferenceTurn,
  onRemoveReference,
  overlayRef,
  pendingReferences,
  session,
  status,
  canAddParagraph,
  canAddSelection,
}: {
  error: string | null;
  onAddParagraph(): void;
  onAddSelection(): void;
  onAsk(question: string): void;
  onClose(): void;
  onReferenceTurn(turnId: string, question: string): void;
  onRemoveReference(key: string): void;
  overlayRef: MutableRefObject<HTMLElement | null>;
  pendingReferences: PendingWorkspaceReference[];
  session: WorkspaceSession | null;
  status: "idle" | "opening" | "asking" | "error";
  canAddParagraph: boolean;
  canAddSelection: boolean;
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
          {!minimized && <small>只回答本轮明确引用的阅读内容</small>}
        </div>
        <nav aria-label="工作区窗口操作">
          <button type="button" aria-label={minimized ? "展开工作区" : "最小化工作区"} onClick={() => setMinimized(!minimized)}>
            <AppIcon icon={minimized ? Maximize2 : Minimize2} size={15} />
          </button>
          <button type="button" aria-label="关闭工作区" title="关闭工作区" onClick={onClose}><AppIcon icon={X} size={15} /></button>
        </nav>
      </header>
      {!minimized && (
        <div className="workspace-body">
          {status === "opening" && <p className="workspace-message">正在恢复本地会话…</p>}
          {session !== null && session.turns.length === 0 && (
            <p className="workspace-message">先引用当前选区、段落或已有学习材料，再提出问题。</p>
          )}
          {session?.turns.map((turn) => (
            <article className="workspace-turn" key={turn.turnId}>
              <p className="workspace-question">{turn.question}</p>
              <div className="workspace-turn-references">
                {turn.references.map((reference) => <span key={reference.referenceId}>{reference.label}</span>)}
              </div>
              <p className="workspace-answer">{turn.answer.content}</p>
              <button type="button" onClick={() => onReferenceTurn(turn.turnId, turn.question)}><AppIcon icon={Quote} size={14} />引用本轮</button>
            </article>
          ))}
          <section className="workspace-composer">
            <div className="workspace-source-actions">
              <button type="button" disabled={!canAddSelection} onClick={onAddSelection}><AppIcon icon={TextSelect} size={14} />引用当前选区</button>
              <button type="button" disabled={!canAddParagraph} onClick={onAddParagraph}><AppIcon icon={Pilcrow} size={14} />引用当前段落</button>
            </div>
            <div className="workspace-pending" aria-label="本轮引用">
              <strong>本轮 References</strong>
              {pendingReferences.length === 0 ? (
                <p>尚未添加引用，不能发送。</p>
              ) : pendingReferences.map((reference) => (
                <span key={reference.key}>
                  {reference.label}
                  <button type="button" aria-label={`移除 ${reference.label}`} title={`移除 ${reference.label}`} onClick={() => onRemoveReference(reference.key)}>
                    <AppIcon icon={X} size={12} />
                  </button>
                </span>
              ))}
            </div>
            <label htmlFor="workspace-question">基于这些材料提问</label>
            <textarea
              id="workspace-question"
              rows={3}
              maxLength={4000}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <button
              className="workspace-send"
              type="button"
              disabled={status === "asking" || session === null || question.trim().length === 0 || pendingReferences.length === 0}
              onClick={() => {
                onAsk(question.trim());
                setQuestion("");
              }}
            >
              <AppIcon className={status === "asking" ? "is-spinning" : undefined} icon={status === "asking" ? LoaderCircle : Send} size={16} />
              {status === "asking" ? "正在回答…" : "发送问题"}
            </button>
            {error !== null && <p className="lens-error">{error}</p>}
          </section>
        </div>
      )}
    </aside>
  );
}
