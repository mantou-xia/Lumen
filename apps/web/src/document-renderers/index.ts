import { MarkdownRenderer } from "./markdown-renderer";
import { RendererRegistry } from "./renderer-registry";

export const documentRendererRegistry = new RendererRegistry([new MarkdownRenderer()]);
