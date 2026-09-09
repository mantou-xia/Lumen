// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentSummary } from "@lumen/api-contract";

import { waitForHealth } from "../api/health";
import { getDocuments } from "../api/library";
import { LibraryPage } from "./LibraryPage";

vi.mock("../api/health", () => ({
  waitForHealth: vi.fn(),
}));

vi.mock("../api/library", () => ({
  getDocuments: vi.fn(),
  importMarkdown: vi.fn(),
}));

const document: DocumentSummary = {
  documentId: "document-1",
  activeRevisionId: "revision-1",
  formatId: "markdown",
  title: "A Room of One's Own",
  originalFilename: "room.md",
  byteSize: 128,
  status: "ready",
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
};

describe("LibraryPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.mocked(waitForHealth).mockResolvedValue({
      status: "ok",
      service: "lumen-local-service",
      version: "0.1.0",
      database: { status: "ready", schemaVersion: 1 },
    });
    vi.mocked(getDocuments).mockResolvedValue([document]);
  });

  it("每篇文档只提供一个进入阅读器的入口", async () => {
    render(
      <MemoryRouter>
        <LibraryPage />
      </MemoryRouter>,
    );

    const documentLinks = await screen.findAllByRole("link", {
      name: /A Room of One's Own/,
    });

    expect(documentLinks).toHaveLength(1);
    expect(documentLinks[0]?.getAttribute("href")).toBe("/reader/document-1");
  });

  it("搜索无结果时不再提供与搜索框重复的清除操作", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LibraryPage />
      </MemoryRouter>,
    );

    const searchInput = await screen.findByRole("searchbox", { name: "搜索文档" });
    await user.type(searchInput, "没有匹配的内容");

    await screen.findByRole("heading", { name: "没有找到相关文档" });
    expect(screen.getAllByRole("button", { name: "清空搜索" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "清除搜索" })).toBeNull();
  });
});
