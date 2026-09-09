// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ReactNode } from "react";
import type { ReaderDocument } from "@lumen/api-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openReaderDocument } from "../api/reader";
import { getProviderStatus } from "../api/translation";
import { ReaderPage } from "./ReaderPage";

vi.mock("../api/reader", () => ({ openReaderDocument: vi.fn() }));
vi.mock("../api/translation", () => ({ getProviderStatus: vi.fn() }));
vi.mock("../app/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../app/preferences", () => ({
  usePreferences: () => ({
    preferences: {
      colorTheme: "light",
      readingWidth: 760,
      readingFontSize: 18,
      readingLineHeight: 1.75,
      autoTranslateSelection: true,
      recallEnabled: true,
    },
  }),
}));
vi.mock("../document-renderers/FormatRendererHost", () => ({
  FormatRendererHost: () => <div data-testid="format-renderer" />,
}));
vi.mock("./useInteractionCoordinator", () => ({
  useInteractionCoordinator: () => ({
    activeRecall: null,
    activeSelectionText: null,
    closeRecall: vi.fn(),
    closeTranslation: vi.fn(),
    handleRendererEvent: vi.fn(),
    linkNotice: null,
    navigateTo: vi.fn(),
    readingProgression: 0,
    recallAnchor: null,
    recallError: null,
    recallStatus: "idle",
    registerRenderer: vi.fn(),
    renderError: null,
    retryActiveTranslation: vi.fn(),
    translation: null,
    translationAnchor: null,
    translationError: null,
    translationStatus: "idle",
    visibleBlockIds: [],
    workspaceSelection: null,
  }),
}));

const reader: ReaderDocument = {
  document: {
    documentId: "document-1",
    activeRevisionId: "revision-1",
    formatId: "markdown",
    title: "示例材料",
    originalFilename: "example.md",
    byteSize: 12,
    status: "ready",
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  },
  revision: {
    revisionId: "revision-1",
    format: {
      formatId: "markdown",
      adapterVersion: "1",
      semanticProjectionVersion: "1",
      renderProjectionVersion: "1",
      sourceMappingVersion: "1",
      supportedCapabilities: {
        selectableText: true,
        stableSourceLocation: true,
        nativeOutline: true,
        pagination: false,
        reflow: true,
        originalLayout: false,
        embeddedResources: false,
        search: false,
        annotations: true,
      },
    },
    capabilities: {
      selectableText: true,
      stableSourceLocation: true,
      nativeOutline: true,
      pagination: false,
      reflow: true,
      originalLayout: false,
      embeddedResources: false,
      search: false,
      annotations: true,
    },
  },
  renderHtml: "<p>示例内容</p>",
  blocks: [{ blockId: "block-1", blockType: "heading", order: 0, text: "第一章", sourceRange: { startOffset: 0, endOffset: 3 } }],
  outline: [{ outlineId: "chapter-1", blockId: "block-1", depth: 2, label: "第一章", order: 0 }],
  progress: null,
};

describe("ReaderPage 目录入口", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.mocked(openReaderDocument).mockResolvedValue(reader);
    vi.mocked(getProviderStatus).mockResolvedValue({
      configured: true,
      provider: "deepseek",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
    });
  });

  it("只保留左侧的完整目录开关，顶栏不再显示目录", async () => {
    render(
      <MemoryRouter initialEntries={["/reader/document-1"]}>
        <Routes>
          <Route path="/reader/:documentId" element={<ReaderPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "打开文档目录" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "目录" })).toBeNull();
  });
});
