import { useCallback, type MutableRefObject } from "react";
import { LoaderCircle, MessageCircleMore } from "lucide-react";
import type { AiFootnote, ConversationTurn } from "@lumen/api-contract";

import { AppIcon } from "../app/AppIcon";
import { Button, ScrollArea, StatusNotice } from "../app/ui";
import type { TranslationAnchor } from "./TranslationLens";
import { useAnchoredOverlayPosition } from "./TranslationLens";
import { SafeMarkdown } from "./SafeMarkdown";

export function ExplanationLens({
  anchor,
  footnote,
  error,
  onContinue,
  onOpenTranslation,
  onRetry,
  overlayRef,
  status,
  turn,
}: {
  anchor: TranslationAnchor | null;
  error: string | null;
  footnote: AiFootnote;
  onContinue(): void;
  onOpenTranslation?: (() => void) | undefined;
  onRetry(): void;
  overlayRef: MutableRefObject<HTMLElement | null>;
  status: "idle" | "loading" | "error";
  turn: ConversationTurn | null;
}) {
  const { lensRef, style } = useAnchoredOverlayPosition(anchor);
  const setRefs = useCallback((element: HTMLElement | null) => {
    lensRef.current = element;
    overlayRef.current = element;
  }, [lensRef, overlayRef]);
  return (
    <ScrollArea axis="y" className="translation-lens explanation-lens" component="aside" data-reader-overlay ref={setRefs} style={style} tabIndex={-1}>
      <div className="translation-heading"><div><h2>{footnote.selectedText}</h2><span>技术解释</span></div></div>
      {status === "loading" && (
        <p className="workspace-message"><AppIcon className="is-spinning" icon={LoaderCircle} size={16} />正在恢复解释…</p>
      )}
      {status === "error" && error !== null && (
        <StatusNotice tone="danger">
          {error}
          <Button type="button" variant="secondary" onClick={onRetry}>重试</Button>
        </StatusNotice>
      )}
      {turn !== null && (
        <>
          <section className="explanation-result"><SafeMarkdown content={turn.answer.content} references={turn.references} /></section>
          <small className="explanation-boundary">
            {turn.answer.knowledgeBoundary === "document_grounded" && "仅依据引用内容"}
            {turn.answer.knowledgeBoundary === "mixed" && "引用内容 + 通用知识"}
            {turn.answer.knowledgeBoundary === "model_knowledge" && "通用知识回答"}
          </small>
          <div className="translation-actions">
            {onOpenTranslation !== undefined && <Button type="button" variant="secondary" onClick={onOpenTranslation}>查看翻译</Button>}
            <Button type="button" onClick={onContinue}><AppIcon icon={MessageCircleMore} size={15} />继续追问</Button>
          </div>
        </>
      )}
    </ScrollArea>
  );
}
