import { describe, expect, it } from "vitest";

import { MarkdownDocumentAdapter } from "./markdown-adapter.js";

function markdownSource(markdown: string, originalFilename = "reading.md") {
  return {
    probe: { originalFilename, mediaType: "text/markdown" },
    content: new TextEncoder().encode(markdown),
  };
}

describe("MarkdownDocumentAdapter", () => {
  it("从同一 AST 生成安全渲染、语义块、目录和 Source Mapping", async () => {
    const artifact = await new MarkdownDocumentAdapter().import(
      markdownSource([
        "# Reading deeply",
        "",
        "A paragraph with **strong meaning** and [a link](https://example.com).",
        "",
        "> Stay curious.",
        "",
        "- First expression",
        "- Second expression",
        "",
        "```ts",
        "const answer = 42;",
        "```",
      ].join("\n")),
      "revision-1",
    );

    expect(artifact.outline).toEqual([
      expect.objectContaining({ blockId: "revision-1:block:0", depth: 1, label: "Reading deeply" }),
    ]);
    expect(artifact.blocks.map((block) => block.blockType)).toEqual([
      "heading",
      "paragraph",
      "blockquote",
      "list_item",
      "list_item",
      "code",
    ]);
    expect(artifact.blocks[1]).toMatchObject({
      text: "A paragraph with strong meaning and a link.",
      sourceRange: { startOffset: 18 },
    });
    expect(artifact.renderHtml).toContain('data-block-id="revision-1:block:0"');
    expect(artifact.renderHtml).toContain('data-block-id="revision-1:block:5"');
    expect(artifact.renderHtml).toContain('<li data-block-id="revision-1:block:3"');
    expect(artifact.renderHtml).toContain("<strong>strong meaning</strong>");
    expect(artifact.renderHtml).toContain('class="shiki shiki-themes');
    expect(artifact.renderHtml).toContain("--shiki-light:");
    expect(artifact.renderHtml).toContain("--shiki-sepia:");
    expect(artifact.renderHtml).toContain("--shiki-dark:");
    expect(artifact.blocks.at(-1)?.text).toBe("const answer = 42;");
    expect(artifact.descriptor.formatId).toBe("markdown");
    expect(artifact.descriptor.semanticProjectionVersion).toBe("markdown.semantic.v2");
    expect(artifact.descriptor.renderProjectionVersion).toBe("markdown.render.v4");
    expect(artifact.sourceMappings).toHaveLength(artifact.blocks.length);
  });

  it("未声明语言时保持纯文本，未知语言安全回退而不猜测", async () => {
    const artifact = await new MarkdownDocumentAdapter().import(
      markdownSource([
        "# Plain code",
        "",
        "```",
        "const plain = true;",
        "```",
        "",
        "```unknown-language",
        "const fallback = true;",
        "```",
      ].join("\n")),
      "revision-plain-code",
    );

    expect(artifact.renderHtml).toContain("const plain = true;");
    expect(artifact.renderHtml).toContain("const fallback = true;");
    expect(artifact.renderHtml).toContain('data-block-id="revision-plain-code:block:1"');
    expect(artifact.renderHtml).toContain('data-block-id="revision-plain-code:block:2"');
    expect(artifact.blocks.filter((block) => block.blockType === "code").map((block) => block.text))
      .toEqual(["const plain = true;", "const fallback = true;"]);
  });

  it("丢弃原始 HTML、危险协议，并在无下载能力的投影重建中保持图片隔离", async () => {
    const artifact = await new MarkdownDocumentAdapter().import(
      markdownSource([
        "# Safety",
        "",
        '<script>alert("bad")</script>',
        "",
        '<img src=x onerror=alert("bad")>',
        "",
        "[danger](javascript:alert(1))",
        "",
        "![cover](https://example.com/tracker.png)",
      ].join("\n")),
      "revision-safe",
    );

    expect(artifact.renderHtml).not.toContain("<script");
    expect(artifact.renderHtml).not.toContain("<img");
    expect(artifact.renderHtml).not.toContain('href="javascript:');
    expect(artifact.renderHtml).not.toContain("tracker.png");
    expect(artifact.renderHtml).toContain("该图片未随原文档保存，请重新导入文档");
    expect(artifact.resources).toEqual([]);
  });

  it("导入时下载可识别图片并改写为受管资源占位地址", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const fetcher = async () => new Response(png, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
    const artifact = await new MarkdownDocumentAdapter(fetcher as typeof fetch).import(
      markdownSource("# Image\n\n![cover](https://example.com/cover.png)"),
      "revision-image",
    );

    expect(artifact.resources).toEqual([
      expect.objectContaining({
        resourceKey: "image-0",
        sourceUrl: "https://example.com/cover.png",
        mediaType: "image/png",
        altText: "cover",
        content: png,
      }),
    ]);
    expect(artifact.renderHtml).toContain('/api/resources/__LUMEN_IMAGE_image-0__');
    expect(artifact.renderHtml).not.toContain("https://example.com/cover.png");
  });

  it("图片下载失败时生成可手动替换的缺失位置", async () => {
    const fetcher = async () => new Response("not found", { status: 404 });
    const artifact = await new MarkdownDocumentAdapter(fetcher as typeof fetch).import(
      markdownSource("# Image\n\n![cover](https://example.com/moved.png)"),
      "revision-missing-image",
    );

    expect(artifact.resources).toEqual([
      expect.objectContaining({ resourceKey: "image-0", content: null, altText: "cover" }),
    ]);
    expect(artifact.renderHtml).toContain('data-missing-image-key="image-0"');
    expect(artifact.renderHtml).toContain("图片已被删除或移动");
  });

  it("文件夹导入时按 Markdown 所在目录解析相对图片", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const source = {
      ...markdownSource("# Chapter\n\n![cover](../shared/cover.png)", "01.md"),
      container: {
        sourcePath: "chapters/01.md",
        files: new Map([
          ["chapters/01.md", new TextEncoder().encode("# Chapter")],
          ["shared/cover.png", png],
        ]),
      },
    };

    const artifact = await new MarkdownDocumentAdapter().import(source, "revision-local-image");

    expect(artifact.resources).toEqual([
      expect.objectContaining({
        sourceUrl: "../shared/cover.png",
        originalFilename: "cover.png",
        mediaType: "image/png",
        content: png,
      }),
    ]);
    expect(artifact.renderHtml).toContain("/api/resources/__LUMEN_IMAGE_image-0__");
  });

  it("文件夹导入时接收相对路径 SVG，并在保存前移除动态内容", async () => {
    const svg = new TextEncoder().encode([
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onclick="alert(1)">',
      '<script>alert("bad")</script>',
      '<rect width="10" height="10" fill="#fff"/>',
      "</svg>",
    ].join(""));
    const source = {
      ...markdownSource("# Chapter\n\n![diagram](../images/diagram.svg)", "01.md"),
      container: {
        sourcePath: "chapters/01.md",
        files: new Map([
          ["chapters/01.md", new TextEncoder().encode("# Chapter")],
          ["images/diagram.svg", svg],
        ]),
      },
    };

    const artifact = await new MarkdownDocumentAdapter().import(source, "revision-local-svg");
    const resource = artifact.resources[0];
    const sanitized = resource?.content === null || resource?.content === undefined
      ? ""
      : new TextDecoder().decode(resource.content);

    expect(resource).toMatchObject({
      sourceUrl: "../images/diagram.svg",
      originalFilename: "diagram.svg",
      mediaType: "image/svg+xml",
    });
    expect(sanitized).toContain("<rect");
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("onclick");
    expect(artifact.renderHtml).toContain("/api/resources/__LUMEN_IMAGE_image-0__");
  });

  it("支持 GFM 表格、删除线、任务列表和自动链接", async () => {
    const artifact = await new MarkdownDocumentAdapter().import(
      markdownSource([
        "# GFM",
        "",
        "| Feature | ANNoy | HNSW |",
        "| :-- | --: | :--: |",
        "| Build speed | Fast | Slower |",
        "| Accuracy | ~~Medium~~ | **High** |",
        "",
        "- [x] Parsed as a task",
        "- [ ] Still readable",
        "",
        "Visit https://example.com for details.",
      ].join("\n")),
      "revision-gfm",
    );

    expect(artifact.blocks.map((block) => block.blockType)).toEqual([
      "heading",
      "table_cell",
      "table_cell",
      "table_cell",
      "table_cell",
      "table_cell",
      "table_cell",
      "table_cell",
      "table_cell",
      "table_cell",
      "list_item",
      "list_item",
      "paragraph",
    ]);
    expect(artifact.renderHtml).toContain("<table>");
    expect(artifact.renderHtml).toContain('<div class="reader-table-scroll">');
    expect(artifact.renderHtml).toContain("<thead>");
    expect(artifact.renderHtml).toContain('data-block-type="table_cell"');
    expect(artifact.renderHtml).toContain("<del>Medium</del>");
    expect(artifact.renderHtml).toContain('type="checkbox"');
    expect(artifact.renderHtml).toContain('href="https://example.com"');
  });

  it("按来源探针检测格式、检查标题并拒绝无效 UTF-8", async () => {
    const adapter = new MarkdownDocumentAdapter();

    expect(adapter.detect({ originalFilename: "chapter.md", mediaType: null })).toBe(true);
    expect(adapter.detect({ originalFilename: "chapter.txt", mediaType: "text/plain" })).toBe(false);
    await expect(adapter.inspect(markdownSource("# Adapter Title\n\nBody"))).resolves.toMatchObject({
      suggestedTitle: "Adapter Title",
      capabilities: { selectableText: true, stableSourceLocation: true },
    });
    await expect(adapter.inspect({
      probe: { originalFilename: "broken.md", mediaType: "text/markdown" },
      content: Uint8Array.from([0xc3, 0x28]),
    })).rejects.toThrow("UTF-8");
  });
});
