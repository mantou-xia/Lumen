// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MutableRefObject } from "react";
import type { LexicalProfileResponse, TranslationResult } from "@lumen/api-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLexicalProfile } from "./useLexicalProfile";
import { calculateLensPosition, TranslationLens } from "./TranslationLens";

vi.mock("./useLexicalProfile", () => ({
  useLexicalProfile: vi.fn(),
}));

const translation: TranslationResult = {
  translationId: "translation-1",
  operationId: "operation-1",
  selection: {
    selectionId: "selection-1",
    documentId: "document-1",
    revisionId: "revision-1",
    start: { blockId: "block-1", offset: 0 },
    end: { blockId: "block-1", offset: 8 },
    selectedText: "take shape",
    sourceRanges: [{
      blockId: "block-1",
      semanticStartOffset: 0,
      semanticEndOffset: 8,
      source: { kind: "markdown", startOffset: 0, endOffset: 8 },
    }],
    fingerprint: "a".repeat(64),
  },
  contextualTranslation: "逐渐成形",
  contextualMeaning: "指一个想法或计划在当前段落中逐渐清晰、形成具体样貌。",
  expressionType: "phrase",
  explanation: "这里强调过程，而不是瞬间完成。",
  uncertainty: "结合上下文推断，可能还包含逐步被理解的含义。",
  surroundingContext: "The idea began to take shape after several discussions.",
  createdAt: "2026-09-09T00:00:00.000Z",
};

const lexicalResponse: LexicalProfileResponse = {
  lookupText: "take shape",
  matchedLemma: "take shape",
  status: "ready",
  profile: {
    entryId: "entry-1",
    lemma: "take shape",
    language: "en",
    pronunciations: [],
    partsOfSpeech: [{
      partOfSpeech: "verb",
      senses: [{ gloss: "to develop a clear form", usageLabels: [], examples: [] }],
    }],
    etymology: "",
    derivedTerms: [],
    relatedTerms: [],
    sourceRevisionId: "revision-1",
    sourceRevisionTimestamp: "2026-09-09T00:00:00.000Z",
    sourceUrl: "https://example.com/entry-1",
    fetchedAt: "2026-09-09T00:00:00.000Z",
  },
  localizationStatus: "ready",
  localization: {
    operationId: "operation-2",
    entryId: "entry-1",
    sourceRevisionId: "revision-1",
    senses: [{ sourceGloss: "to develop a clear form", chineseGloss: "逐渐成形", usageNote: "" }],
    etymologySummary: "",
    localizedAt: "2026-09-09T00:00:00.000Z",
  },
  message: null,
  attribution: {
    sourceName: "English Wiktionary",
    sourceUrl: "https://example.com/source",
    licenseName: "CC BY-SA 4.0 / GFDL",
    licenseUrl: "https://example.com/license",
    attributionText: "English Wiktionary attribution",
  },
};

function renderLens(actions = {
  onRetry: vi.fn(),
  onReferenceWorkspace: vi.fn(),
  onSave: vi.fn(),
}) {
  return {
    ...actions,
    ...render(
      <TranslationLens
        activeSelectionText="take shape"
        anchor={null}
        error={null}
        overlayRef={{ current: null } as MutableRefObject<HTMLElement | null>}
        saveState="idle"
        status="idle"
        translation={translation}
        {...actions}
      />,
    ),
  };
}

describe("Translation Lens 定位", () => {
  it("下方空间不足时放在选区上方且不遮挡选区", () => {
    const position = calculateLensPosition({
      anchor: {
        bounds: { top: 600, right: 400, bottom: 620, left: 300 },
        scrollX: 0,
        scrollY: 0,
      },
      elementWidth: 360,
      elementHeight: 400,
      viewportWidth: 900,
      viewportHeight: 700,
      scrollX: 0,
      scrollY: 0,
    });

    expect(position.top).toBe(190);
    expect(position.top + 400).toBeLessThan(600);
  });

  it("窄窗口中限制在视口边界内", () => {
    const position = calculateLensPosition({
      anchor: {
        bounds: { top: 40, right: 350, bottom: 60, left: 330 },
        scrollX: 0,
        scrollY: 0,
      },
      elementWidth: 360,
      elementHeight: 300,
      viewportWidth: 390,
      viewportHeight: 700,
      scrollX: 0,
      scrollY: 0,
    });

    expect(position.left).toBe(16);
    expect(position.top).toBe(70);
  });

  it("滚动后按原选区的文档位置重算", () => {
    const position = calculateLensPosition({
      anchor: {
        bounds: { top: 300, right: 300, bottom: 320, left: 120 },
        scrollX: 0,
        scrollY: 100,
      },
      elementWidth: 300,
      elementHeight: 200,
      viewportWidth: 900,
      viewportHeight: 700,
      scrollX: 0,
      scrollY: 180,
    });

    expect(position).toEqual({ top: 250, left: 120 });
  });

  it("原词滚出视口后卡片继续跟随而不是吸附在视口边缘", () => {
    const position = calculateLensPosition({
      anchor: {
        bounds: { top: 300, right: 300, bottom: 320, left: 120 },
        scrollX: 0,
        scrollY: 0,
      },
      elementWidth: 300,
      elementHeight: 200,
      viewportWidth: 900,
      viewportHeight: 700,
      scrollX: 0,
      scrollY: 600,
    });

    expect(position).toEqual({ top: -270, left: 120 });
  });
});

describe("Translation Lens 信息层级", () => {
  const refresh = vi.fn();

  beforeEach(() => {
    refresh.mockReset();
    vi.mocked(useLexicalProfile).mockReturnValue({
      error: null,
      refresh,
      response: lexicalResponse,
      status: "idle",
    });
  });

  it("默认折叠词汇资料，并保留两条独立刷新路径", async () => {
    const user = userEvent.setup();
    const { container, onRetry } = renderLens();

    const lexicalDetails = container.querySelector<HTMLDetailsElement>(".translation-lexical-details");
    expect(lexicalDetails?.open).toBe(false);
    expect([...container.querySelectorAll(".translation-actions > button")].map((button) => button.textContent))
      .toEqual(["收藏这个表达", "重新翻译", "引用到 Workspace"]);

    await user.click(screen.getByRole("button", { name: "重新翻译" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    await user.click(lexicalDetails!.querySelector("summary")!);
    await user.click(screen.getByRole("button", { name: "更新资料" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
