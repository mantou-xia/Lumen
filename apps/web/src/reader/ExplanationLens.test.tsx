import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AiFootnote } from "@lumen/api-contract";
import { describe, expect, it, vi } from "vitest";

import { ExplanationLens } from "./ExplanationLens";
import { WorkspacePanel } from "./WorkspacePanel";

describe("ExplanationLens", () => {
  it("在当前解释位置显示恢复失败和重试入口", () => {
    const html = renderToStaticMarkup(
      <ExplanationLens
        anchor={null}
        error="无法恢复这条解释"
        footnote={footnote}
        onContinue={vi.fn()}
        onRetry={vi.fn()}
        overlayRef={createRef<HTMLElement>()}
        status="error"
        turn={null}
      />,
    );

    expect(html).toContain("无法恢复这条解释");
    expect(html).toContain("重试");
  });

  it("解释恢复错误不会显示在 Workspace", () => {
    const html = renderToStaticMarkup(
      <WorkspacePanel
        canReferenceDocument={true}
        conversation={null}
        currentSelection={null}
        error={null}
        onAsk={vi.fn()}
        onClearSelection={vi.fn()}
        onClose={vi.fn()}
        onNavigateReference={vi.fn()}
        onReferenceTurn={vi.fn()}
        onRemoveReference={vi.fn()}
        onToggleReferenceMode={vi.fn()}
        overlayRef={createRef<HTMLElement>()}
        pendingReferences={[]}
        referenceMode={false}
        referenceTargetKind={null}
        status="idle"
      />,
    );

    expect(html).not.toContain("无法恢复这条解释");
  });
});

const footnote: AiFootnote = {
  footnoteId: "footnote-1",
  conversationId: "conversation-1",
  turnId: "turn-1",
  capabilityId: "selection.technical-explanation.v1",
  documentId: "document-1",
  revisionId: "revision-1",
  selectionFingerprint: "selection-1",
  selectedText: "selection",
  start: { blockId: "block-1", offset: 0 },
  end: { blockId: "block-1", offset: 9 },
  status: "active",
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
};
