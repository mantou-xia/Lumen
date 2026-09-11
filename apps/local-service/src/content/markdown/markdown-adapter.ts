import type { Element, Root as HastRoot } from "hast";
import { posix } from "node:path";
import { toText } from "hast-util-to-text";
import type { Nodes, Parent, Root as MdastRoot } from "mdast";
import { toString } from "mdast-util-to-string";
import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

import type {
  DocumentCapabilities,
  DocumentFormatDescriptor,
  OutlineEntry,
  SemanticBlock,
  SemanticBlockType,
} from "@lumen/api-contract";

import {
  DocumentSourceError,
  type DocumentAdapter,
  type DocumentInspection,
  type DocumentSource,
  type DocumentSourceProbe,
  type ExtractedResourceArtifact,
  type ImportArtifact,
} from "../format/format-contract.js";
import {
  getMarkdownCodeHighlighter,
  markdownCodeHighlightOptions,
} from "./markdown-code-highlighter.js";
import { imageExtension, prepareImageContent } from "../image-media.js";

export const markdownProjectionVersions = {
  adapter: "markdown.adapter.v3",
  semantic: "markdown.semantic.v2",
  render: "markdown.render.v4",
  sourceMapping: "markdown.source-map.v2",
} as const;

export const markdownCapabilities: DocumentCapabilities = {
  selectableText: true,
  stableSourceLocation: true,
  nativeOutline: true,
  pagination: false,
  reflow: true,
  originalLayout: false,
  embeddedResources: true,
  search: true,
  annotations: true,
};

export const markdownFormatDescriptor: DocumentFormatDescriptor = {
  formatId: "markdown",
  adapterVersion: markdownProjectionVersions.adapter,
  semanticProjectionVersion: markdownProjectionVersions.semantic,
  renderProjectionVersion: markdownProjectionVersions.render,
  sourceMappingVersion: markdownProjectionVersions.sourceMapping,
  supportedCapabilities: markdownCapabilities,
};

function decodeMarkdown(source: DocumentSource): string {
  if (source.content.includes(0)) {
    throw new DocumentSourceError("Markdown 文件包含无效的二进制内容");
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(source.content);
  } catch (error) {
    throw new DocumentSourceError("Markdown 文件必须使用有效的 UTF-8 编码", { cause: error });
  }
}

function blockType(node: Nodes, parent: Parent | undefined): SemanticBlockType | null {
  if (node.type === "heading") return "heading";
  if (node.type === "code") return "code";
  if (node.type === "tableCell") return "table_cell";
  if (node.type === "listItem") return "list_item";
  if (node.type === "thematicBreak") return "separator";
  if (node.type !== "paragraph") return null;
  if (parent?.type === "listItem" || parent?.type === "tableCell") return null;
  if (parent?.type === "blockquote") return "blockquote";
  return "paragraph";
}

function annotateMarkdown(
  revisionId: string,
  blocks: SemanticBlock[],
  outline: OutlineEntry[],
) {
  return (tree: MdastRoot): void => {
    visit(tree, (node, _index, parent) => {
      const type = blockType(node, parent);
      if (type === null) return;

      const sourceStart = node.position?.start.offset;
      const sourceEnd = node.position?.end.offset;
      if (sourceStart === undefined || sourceEnd === undefined) {
        throw new Error("Markdown AST 节点缺少稳定 Source Range");
      }

      const order = blocks.length;
      const blockId = `${revisionId}:block:${order}`;
      const text = type === "separator" ? "" : toString(node);
      blocks.push({
        blockId,
        blockType: type,
        order,
        text,
        sourceRange: { startOffset: sourceStart, endOffset: sourceEnd },
      });

      node.data = {
        ...node.data,
        hProperties: {
          ...(node.data?.hProperties ?? {}),
          dataBlockId: blockId,
          dataBlockType: type,
        },
      };

      if (node.type === "heading" && text.trim().length > 0) {
        outline.push({
          outlineId: `${revisionId}:outline:${outline.length}`,
          blockId,
          depth: node.depth,
          label: text.trim(),
          order: outline.length,
        });
      }
    });
  };
}

const maxManagedImageBytes = 10 * 1024 * 1024;
const maxImageRedirects = 5;

function isPrivateImageTarget(url: URL): boolean {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname === "::" || hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd")) return true;
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  return octets[0] === 0
    || octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127)
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || octets[0]! >= 224;
}

function filenameFromImageUrl(sourceUrl: string, index: number, mediaType: string): string {
  const pathname = new URL(sourceUrl).pathname;
  const candidate = pathname.split("/").at(-1)?.trim();
  return candidate && /^[^\\/:*?"<>|]+$/u.test(candidate)
    ? candidate
    : `markdown-image-${index + 1}${imageExtension(mediaType)}`;
}

async function downloadImage(
  fetcher: typeof fetch | undefined,
  sourceUrl: string,
): Promise<{ content: Uint8Array; mediaType: string } | null> {
  if (fetcher === undefined) return null;
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || isPrivateImageTarget(url)
  ) return null;

  try {
    let response: Response | null = null;
    for (let redirectCount = 0; redirectCount <= maxImageRedirects; redirectCount += 1) {
      response = await fetcher(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
        headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml" },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (location === null || redirectCount === maxImageRedirects) return null;
      url = new URL(location, url);
      if (
        (url.protocol !== "http:" && url.protocol !== "https:")
        || isPrivateImageTarget(url)
      ) return null;
    }
    if (response === null) return null;
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (!response.ok || declaredLength > maxManagedImageBytes) return null;
    const content = new Uint8Array(await response.arrayBuffer());
    if (content.byteLength === 0 || content.byteLength > maxManagedImageBytes) return null;
    return prepareImageContent(content);
  } catch {
    return null;
  }
}

function isLocalImageReference(sourceUrl: string): boolean {
  return sourceUrl.length > 0
    && !sourceUrl.startsWith("//")
    && !/^[a-z][a-z0-9+.-]*:/iu.test(sourceUrl)
    && !sourceUrl.startsWith("#");
}

function readContainerImage(
  source: DocumentSource,
  sourceUrl: string,
): { content: Uint8Array; mediaType: string; originalFilename: string } | null {
  if (source.container === undefined || !isLocalImageReference(sourceUrl)) return null;
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(sourceUrl.split(/[?#]/u, 1)[0]!).replaceAll("\\", "/");
  } catch {
    return null;
  }
  const combinedPath = decodedPath.startsWith("/")
    ? decodedPath.slice(1)
    : posix.join(posix.dirname(source.container.sourcePath), decodedPath);
  const normalizedPath = posix.normalize(combinedPath);
  if (
    normalizedPath.length === 0
    || normalizedPath === "."
    || normalizedPath === ".."
    || normalizedPath.startsWith("../")
    || normalizedPath.startsWith("/")
  ) return null;
  const content = source.container.files.get(normalizedPath);
  if (content === undefined || content.byteLength === 0 || content.byteLength > maxManagedImageBytes) {
    return null;
  }
  const prepared = prepareImageContent(content);
  return prepared === null
    ? null
    : { ...prepared, originalFilename: posix.basename(normalizedPath) };
}

function localizeImages(
  fetcher: typeof fetch | undefined,
  resources: ExtractedResourceArtifact[],
  source: DocumentSource,
) {
  return async (tree: HastRoot): Promise<void> => {
    const images: Element[] = [];
    visit(tree, "element", (node: Element) => {
      if (node.tagName === "img") {
        images.push(node);
      }
      if (node.tagName === "a") {
        node.properties.rel = ["noopener", "noreferrer"];
        node.properties.dataReaderLink = true;
      }
    });
    await Promise.all(images.map(async (node, index) => {
      const sourceUrl = typeof node.properties.src === "string" ? node.properties.src : "";
      const altText = typeof node.properties.alt === "string" && node.properties.alt.trim().length > 0
        ? node.properties.alt.trim()
        : "图片";
      const resourceKey = `image-${index}`;
      const localImage = readContainerImage(source, sourceUrl);
      if (fetcher === undefined && !isLocalImageReference(sourceUrl)) {
        node.tagName = "span";
        node.properties = { className: ["reader-image-placeholder"] };
        node.children = [{ type: "text", value: "该图片未随原文档保存，请重新导入文档" }];
        return;
      }
      const downloaded = localImage ?? await downloadImage(fetcher, sourceUrl);
      resources.push({
        resourceKey,
        sourceUrl,
        originalFilename: downloaded === null
          ? `markdown-image-${index + 1}.image`
          : localImage?.originalFilename
            ?? filenameFromImageUrl(sourceUrl, index, downloaded.mediaType),
        mediaType: downloaded?.mediaType ?? "application/octet-stream",
        role: "embedded_resource",
        altText,
        content: downloaded?.content ?? null,
      });
      if (downloaded !== null) {
        node.properties.src = `/api/resources/__LUMEN_IMAGE_${resourceKey}__`;
        node.properties.alt = altText;
        node.properties.loading = "lazy";
        return;
      }
      node.tagName = "span";
      node.properties = {
        className: ["reader-image-placeholder"],
        dataMissingImageKey: resourceKey,
      };
      node.children = [{ type: "text", value: "图片已被删除或移动" }];
    }));
  };
}

function wrapTablesForHorizontalScrolling() {
  return (tree: HastRoot): void => {
    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "table" || parent === undefined || typeof index !== "number") return;
      const parentClasses = parent.type === "element" ? parent.properties.className : undefined;
      if (Array.isArray(parentClasses) && parentClasses.includes("reader-table-scroll")) return;
      parent.children[index] = {
        type: "element",
        tagName: "div",
        properties: { className: ["reader-table-scroll"] },
        children: [node],
      };
    });
  };
}

function attachCodeBlockHighlightMetadata(blocks: SemanticBlock[]) {
  return (tree: HastRoot): void => {
    const codeBlocks = blocks.filter((block) => block.blockType === "code");
    const visited = new WeakSet<Element>();
    let codeBlockIndex = 0;
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "pre") return;
      if (visited.has(node)) return;
      visited.add(node);
      const code = node.children.find(
        (child): child is Element => child.type === "element" && child.tagName === "code",
      );
      if (code === undefined) return;
      const block = codeBlocks[codeBlockIndex];
      if (block === undefined) throw new Error("Markdown Render Projection 出现未映射的代码块");
      codeBlockIndex += 1;
      node.properties.dataBlockId = block.blockId;
      node.properties.dataBlockType = block.blockType;
      code.data = { ...code.data, meta: block.blockId };
    });

    if (codeBlockIndex !== codeBlocks.length) {
      throw new Error("Markdown Render Projection 缺少代码块映射");
    }
  };
}

function synchronizeRenderedText(blocks: SemanticBlock[]) {
  return (tree: HastRoot): void => {
    const blockById = new Map(blocks.map((block) => [block.blockId, block]));
    visit(tree, "element", (node: Element) => {
      const blockId = node.properties.dataBlockId;
      if (typeof blockId !== "string") return;
      const block = blockById.get(blockId);
      if (block !== undefined) {
        block.text = toText(node);
      }
    });
  };
}

const markdownSanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "dataBlockId", "dataBlockType"],
    a: [...(defaultSchema.attributes?.a ?? []), "dataReaderLink", "rel"],
    input: [...(defaultSchema.attributes?.input ?? []), "checked", "disabled", "type"],
    div: [...(defaultSchema.attributes?.div ?? []), "className"],
    span: [...(defaultSchema.attributes?.span ?? []), "className", "dataMissingImageKey"],
    img: [...(defaultSchema.attributes?.img ?? []), "loading"],
  },
};

export class MarkdownDocumentAdapter implements DocumentAdapter {
  constructor(private readonly fetcher?: typeof fetch) {}
  readonly descriptor = markdownFormatDescriptor;
  readonly sourceFileExtension = ".md";
  readonly sourceMediaType = "text/markdown";

  detect(probe: DocumentSourceProbe): boolean {
    const extensionMatches = probe.originalFilename.toLowerCase().endsWith(".md");
    const normalizedMediaType = probe.mediaType?.split(";", 1)[0]?.trim().toLowerCase();
    return extensionMatches || normalizedMediaType === this.sourceMediaType;
  }

  async inspect(source: DocumentSource): Promise<DocumentInspection> {
    const markdown = decodeMarkdown(source);
    const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? null;
    return {
      suggestedTitle: heading?.length ? heading : null,
      capabilities: { ...markdownCapabilities },
      warnings: [],
    };
  }

  async import(source: DocumentSource, revisionId: string): Promise<ImportArtifact> {
    const markdown = decodeMarkdown(source);
    const blocks: SemanticBlock[] = [];
    const outline: OutlineEntry[] = [];
    const resources: ExtractedResourceArtifact[] = [];
    const codeHighlighter = await getMarkdownCodeHighlighter();
    const file = await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(() => annotateMarkdown(revisionId, blocks, outline))
      .use(remarkRehype)
      .use(localizeImages, this.fetcher, resources, source)
      .use(wrapTablesForHorizontalScrolling)
      .use(rehypeSanitize, markdownSanitizeSchema)
      .use(() => attachCodeBlockHighlightMetadata(blocks))
      .use(rehypeShikiFromHighlighter, codeHighlighter, {
        ...markdownCodeHighlightOptions,
        parseMetaString(blockId) {
          const block = blocks.find((candidate) => candidate.blockId === blockId);
          return {
            dataBlockId: block?.blockId,
            dataBlockType: block?.blockType,
          };
        },
      })
      .use(() => synchronizeRenderedText(blocks))
      .use(rehypeStringify)
      .process(markdown);

    if (blocks.length === 0) {
      throw new DocumentSourceError("Markdown 未生成可阅读语义块");
    }

    const artifact: ImportArtifact = {
      descriptor: this.descriptor,
      capabilities: { ...markdownCapabilities },
      renderHtml: String(file),
      blocks,
      outline,
      sourceMappings: blocks.map((block) => ({
        mappingId: `${revisionId}:source-map:${block.order}`,
        blockId: block.blockId,
        mappingKind: "markdown_offset",
        semanticStartOffset: 0,
        semanticEndOffset: block.text.length,
        sourceStartOffset: block.sourceRange.startOffset,
        sourceEndOffset: block.sourceRange.endOffset,
      })),
      resources,
    };
    this.validateArtifact(artifact);
    return artifact;
  }

  async extractResources(): Promise<ExtractedResourceArtifact[]> {
    return [];
  }

  validateArtifact(artifact: ImportArtifact): void {
    if (artifact.descriptor.formatId !== this.descriptor.formatId) {
      throw new Error("Markdown 导入产物的格式标识不一致");
    }
    if (artifact.blocks.length === 0 || artifact.sourceMappings.length !== artifact.blocks.length) {
      throw new Error("Markdown 导入产物缺少完整的语义块或 Source Mapping");
    }
    const blockIds = new Set(artifact.blocks.map((block) => block.blockId));
    if (artifact.sourceMappings.some((mapping) => !blockIds.has(mapping.blockId))) {
      throw new Error("Markdown Source Mapping 引用了不存在的语义块");
    }
  }
}
