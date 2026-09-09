import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ScrollArea } from "./ui";

describe("ScrollArea", () => {
  it("按指定语义元素输出统一滚动区域状态", () => {
    const markup = renderToStaticMarkup(
      <ScrollArea axis="y" component="main" aria-label="页面内容">
        内容
      </ScrollArea>,
    );

    expect(markup).toContain("<main");
    expect(markup).toContain("ui-scroll-area--y");
    expect(markup).toContain('aria-label="页面内容"');
  });

  it("默认使用普通容器", () => {
    const markup = renderToStaticMarkup(<ScrollArea axis="x">筛选项</ScrollArea>);

    expect(markup).toContain("<div");
    expect(markup).toContain("ui-scroll-area--x");
  });
});
