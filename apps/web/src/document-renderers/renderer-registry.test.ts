import { describe, expect, it } from "vitest";
import type { DocumentFormatDescriptor } from "@lumen/api-contract";

import { MarkdownRenderer } from "./markdown-renderer";
import { RendererRegistry } from "./renderer-registry";

const markdownDescriptor: DocumentFormatDescriptor = {
  formatId: "markdown",
  adapterVersion: "markdown.adapter.v1",
  semanticProjectionVersion: "markdown.semantic.v1",
  renderProjectionVersion: "markdown.render.v1",
  sourceMappingVersion: "markdown.source-map.v1",
  supportedCapabilities: {
    selectableText: true,
    stableSourceLocation: true,
    nativeOutline: true,
    pagination: false,
    reflow: true,
    originalLayout: false,
    embeddedResources: false,
    search: true,
    annotations: true,
  },
};

describe("RendererRegistry", () => {
  it("按格式和 Render Projection 版本解析 Renderer", () => {
    const registry = new RendererRegistry([new MarkdownRenderer()]);

    expect(registry.resolve(markdownDescriptor)?.formatId).toBe("markdown");
    expect(registry.resolve({
      ...markdownDescriptor,
      renderProjectionVersion: "markdown.render.legacy",
    })?.formatId).toBe("markdown");
    expect(registry.resolve({
      ...markdownDescriptor,
      formatId: "epub",
      renderProjectionVersion: "epub.render.v1",
    })).toBeNull();
  });

  it("拒绝重复格式注册", () => {
    expect(() => new RendererRegistry([new MarkdownRenderer(), new MarkdownRenderer()]))
      .toThrow("重复注册");
  });
});
