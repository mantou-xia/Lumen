import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LexicalProfileResponse, TranslationResult } from "@lumen/api-contract";
import { describe, expect, it, vi } from "vitest";

const useLexicalProfileMock = vi.hoisted(() => vi.fn());

vi.mock("./useLexicalProfile", () => ({
  useLexicalProfile: useLexicalProfileMock,
}));

import {
  calculateLensPosition,
  getLexicalTranslationId,
  getSupportingExplanation,
  TranslationLens,
} from "./TranslationLens";

const baseTranslation: TranslationResult = {
  translationId: "translation-1",
  operationId: "operation-1",
  selection: {
    selectionId: "selection-1",
    documentId: "document-1",
    revisionId: "revision-1",
    start: { blockId: "block-1", offset: 0 },
    end: { blockId: "block-1", offset: 13 },
    selectedText: "sophisticated",
    sourceRanges: [{
      blockId: "block-1",
      semanticStartOffset: 0,
      semanticEndOffset: 13,
      source: { kind: "markdown_offset", startOffset: 0, endOffset: 13 },
    }],
    fingerprint: "a".repeat(64),
  },
  contextualTranslation: "复杂精密的",
  contextualMeaning: "在本句中形容经过周密设计的技术方案。",
  expressionType: "word",
  explanation: "这里强调结构和设计成熟。",
  uncertainty: "",
  surroundingContext: "A sophisticated mechanism.",
  createdAt: "2026-09-11T00:00:00.000Z",
};

const lexicalResponse: LexicalProfileResponse = {
  lookupText: "sophisticated",
  matchedLemma: "sophisticated",
  status: "ready",
  localizationStatus: "ready",
  message: null,
  profile: {
    entryId: "en.wiktionary:sophisticated",
    lemma: "sophisticated",
    language: "en",
    pronunciations: [{ system: "ipa", value: "/səˈfɪstɪkeɪtɪd/" }],
    partsOfSpeech: [{
      partOfSpeech: "adjective",
      senses: [
        { gloss: "Complicated, especially of technology.", usageLabels: ["technology"], examples: [] },
        { gloss: "Having obtained worldly experience.", usageLabels: [], examples: [] },
      ],
    }],
    etymology: "From sophisticate + -ed.",
    derivedTerms: ["sophistication"],
    relatedTerms: ["sophisticate"],
    sourceRevisionId: "revision-lexical-1",
    sourceRevisionTimestamp: "2026-09-11T00:00:00.000Z",
    sourceUrl: "https://en.wiktionary.org/wiki/sophisticated",
    fetchedAt: "2026-09-11T00:00:00.000Z",
  },
  localization: {
    operationId: "operation-lexical-1",
    entryId: "en.wiktionary:sophisticated",
    sourceRevisionId: "revision-lexical-1",
    senses: [
      {
        sourceGloss: "Complicated, especially of technology.",
        chineseGloss: "复杂精密的，尤指技术",
        usageNote: "常用于系统、方法和设备。",
      },
      {
        sourceGloss: "Having obtained worldly experience.",
        chineseGloss: "老练的，世故的",
        usageNote: "常用于描述人。",
      },
    ],
    etymologySummary: "由 sophisticate 加 -ed 构成。",
    localizedAt: "2026-09-11T00:00:00.000Z",
  },
  attribution: {
    sourceName: "English Wiktionary",
    sourceUrl: "https://en.wiktionary.org/wiki/sophisticated",
    licenseName: "CC BY-SA 4.0 / GFDL",
    licenseUrl: "https://en.wiktionary.org/wiki/Wiktionary:Copyrights",
    attributionText: "Source: English Wiktionary contributors.",
  },
};

function renderLens(translation: TranslationResult): string {
  return renderToStaticMarkup(createElement(TranslationLens, {
    activeSelectionText: translation.selection.selectedText,
    anchor: null,
    error: null,
    overlayRef: { current: null },
    saveState: "idle",
    status: "idle",
    translation,
    onRetry: vi.fn(),
    onReferenceWorkspace: vi.fn(),
    onSave: vi.fn(),
  }));
}

describe("Translation Lens 信息收敛", () => {
  it("只为词语、短语和搭配加载稳定词汇资料", () => {
    expect(getLexicalTranslationId(null)).toBeNull();
    expect(getLexicalTranslationId({ translationId: "translation-word", expressionType: "word" }))
      .toBe("translation-word");
    expect(getLexicalTranslationId({ translationId: "translation-phrase", expressionType: "phrase" }))
      .toBe("translation-phrase");
    expect(getLexicalTranslationId({ translationId: "translation-collocation", expressionType: "collocation" }))
      .toBe("translation-collocation");
    expect(getLexicalTranslationId({ translationId: "translation-sentence", expressionType: "sentence" }))
      .toBeNull();
  });

  it("不重复展示已经由当前含义覆盖的解释", () => {
    expect(getSupportingExplanation({
      contextualMeaning: "指在当前语境中用心体会。",
      contextualTranslation: "用心体会",
      explanation: " 指在当前语境中用心体会 ",
    })).toBeNull();

    expect(getSupportingExplanation({
      contextualMeaning: "指在当前语境中用心体会。",
      contextualTranslation: "用心体会",
      explanation: "这里强调理解不能只停留在表面。",
    })).toBe("这里强调理解不能只停留在表面。");
  });

  it("直接展示全部词义、构词、词族与来源信息", () => {
    useLexicalProfileMock.mockReturnValue({
      error: null,
      refresh: vi.fn(),
      response: lexicalResponse,
      status: "idle",
    });

    const markup = renderLens(baseTranslation);

    expect(markup).toContain("更多词义与构词");
    expect(markup).toContain("复杂精密的，尤指技术");
    expect(markup).toContain("老练的，世故的");
    expect(markup).toContain("由 sophisticate 加 -ed 构成。");
    expect(markup).toContain("sophistication · sophisticate");
    expect(markup).toContain("English Wiktionary");
    expect(markup).toContain("CC BY-SA 4.0 / GFDL");
    expect(markup).not.toContain("<details");
  });

  it("句子模式只保留语境结果且不给词汇面板留空白", () => {
    useLexicalProfileMock.mockReturnValue({
      error: null,
      refresh: vi.fn(),
      response: lexicalResponse,
      status: "idle",
    });

    const markup = renderLens({
      ...baseTranslation,
      expressionType: "sentence",
      selection: {
        ...baseTranslation.selection,
        selectedText: "Raft uses a heartbeat mechanism to trigger leader election.",
      },
    });

    expect(useLexicalProfileMock).toHaveBeenLastCalledWith(null);
    expect(markup).toContain("translation-lens--sentence");
    expect(markup).not.toContain("词汇补充");
    expect(markup).not.toContain("更多词义与构词");
  });
});

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
