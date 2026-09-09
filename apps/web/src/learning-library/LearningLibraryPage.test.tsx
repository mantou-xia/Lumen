// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getLearningItems } from "../api/learning";
import { getDocuments } from "../api/library";
import { LearningLibraryPage } from "./LearningLibraryPage";

vi.mock("../api/learning", () => ({
  getLearningItems: vi.fn(),
}));

vi.mock("../api/library", () => ({
  getDocuments: vi.fn(),
}));

describe("LearningLibraryPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.mocked(getDocuments).mockResolvedValue([]);
    vi.mocked(getLearningItems).mockResolvedValue({
      items: [],
      nextCursor: null,
      totalExpressions: 0,
      totalContexts: 0,
    });
  });

  it("搜索无结果时不增加重复的清除筛选入口，且筛选清除不影响关键词", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LearningLibraryPage />
      </MemoryRouter>,
    );

    const searchInput = await screen.findByRole("searchbox", { name: "搜索表达" });
    await user.type(searchInput, "没有匹配的表达");
    await screen.findByRole("heading", { name: "没有找到相关表达" });

    const clearFilterButtons = screen.getAllByRole("button", { name: "清除筛选" });
    expect(clearFilterButtons).toHaveLength(1);
    await user.click(clearFilterButtons[0]!);
    expect((searchInput as HTMLInputElement).value).toBe("没有匹配的表达");
  });
});
