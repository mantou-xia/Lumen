import { describe, expect, it } from "vitest";

import { MarkdownDocumentAdapter } from "../markdown/markdown-adapter.js";
import { FormatAdapterRegistry } from "./format-adapter-registry.js";

describe("FormatAdapterRegistry", () => {
  it("按统一来源探针解析已注册格式", () => {
    const registry = new FormatAdapterRegistry([new MarkdownDocumentAdapter()]);

    expect(registry.resolve({ originalFilename: "reading.md", mediaType: null })?.descriptor.formatId)
      .toBe("markdown");
    expect(registry.resolve({ originalFilename: "reading.txt", mediaType: "text/plain" }))
      .toBeNull();
    expect(registry.get("markdown")?.sourceMediaType).toBe("text/markdown");
  });

  it("拒绝重复格式注册", () => {
    expect(() => new FormatAdapterRegistry([
      new MarkdownDocumentAdapter(),
      new MarkdownDocumentAdapter(),
    ])).toThrow("重复注册");
  });
});
