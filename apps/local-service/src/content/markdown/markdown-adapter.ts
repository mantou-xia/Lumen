import type { Element, Root as HastRoot } from "hast";
import { toText } from "hast-util-to-text";
import type { Nodes, Parent, Root as MdastRoot } from "mdast";
import { toString } from "mdast-util-to-string";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

import type { OutlineEntry, SemanticBlock, SemanticBlockType } from "@lumen/api-contract";

export const markdownProjectionVersions = {
  adapter: "markdown.adapter.v1",
  semantic: "markdown.semantic.v1",
  render: "markdown.render.v1",
  sourceMapping: "markdown.source-map.v1",
} as const;

export interface MarkdownImportArtifact {
  renderHtml: string;
  blocks: SemanticBlock[];
  outline: OutlineEntry[];
  versions: typeof markdownProjectionVersions;
}

function blockType(node: Nodes, parent: Parent | undefined): SemanticBlockType | null {
  if (node.type === "heading") return "heading";
  if (node.type === "code") return "code";
  if (node.type === "thematicBreak") return "separator";
  if (node.type !== "paragraph") return null;
  if (parent?.type === "listItem") return "list_item";
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

function blockExternalImages() {
  return (tree: HastRoot): void => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName === "img") {
        const alt = typeof node.properties.alt === "string" ? node.properties.alt : "图片";
        node.tagName = "span";
        node.properties = { className: ["reader-image-placeholder"] };
        node.children = [{ type: "text", value: `[外部图片已阻止：${alt}]` }];
      }
      if (node.tagName === "a") {
        node.properties.rel = ["noopener", "noreferrer"];
        node.properties.dataReaderLink = true;
      }
    });
  };
}

function synchronizeRenderedText(blocks: SemanticBlock[]) {
  const blockById = new Map(blocks.map((block) => [block.blockId, block]));
  return (tree: HastRoot): void => {
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
    span: [...(defaultSchema.attributes?.span ?? []), "className"],
  },
};

export class MarkdownDocumentAdapter {
  async import(markdown: string, revisionId: string): Promise<MarkdownImportArtifact> {
    const blocks: SemanticBlock[] = [];
    const outline: OutlineEntry[] = [];
    const file = await unified()
      .use(remarkParse)
      .use(() => annotateMarkdown(revisionId, blocks, outline))
      .use(remarkRehype)
      .use(blockExternalImages)
      .use(rehypeSanitize, markdownSanitizeSchema)
      .use(() => synchronizeRenderedText(blocks))
      .use(rehypeStringify)
      .process(markdown);

    if (blocks.length === 0) {
      throw new Error("Markdown 未生成可阅读语义块");
    }

    return {
      renderHtml: String(file),
      blocks,
      outline,
      versions: markdownProjectionVersions,
    };
  }
}
