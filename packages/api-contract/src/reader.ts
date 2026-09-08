import { z } from "zod";

import {
  documentCapabilitiesSchema,
  documentFormatDescriptorSchema,
} from "./format.js";
import { documentSummarySchema } from "./library.js";

export const semanticBlockTypeSchema = z.enum([
  "heading",
  "paragraph",
  "list_item",
  "blockquote",
  "code",
  "image",
  "separator",
]);

export const sourceRangeSchema = z.object({
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
});

export const semanticBlockSchema = z.object({
  blockId: z.string().min(1),
  blockType: semanticBlockTypeSchema,
  order: z.number().int().nonnegative(),
  text: z.string(),
  sourceRange: sourceRangeSchema,
});

export const outlineEntrySchema = z.object({
  outlineId: z.string().min(1),
  blockId: z.string().min(1),
  depth: z.number().int().min(1).max(6),
  label: z.string().min(1),
  order: z.number().int().nonnegative(),
});

export const readingProgressSchema = z.object({
  documentId: z.string().min(1),
  revisionId: z.string().min(1),
  blockId: z.string().min(1),
  offset: z.number().int().nonnegative(),
  progression: z.number().min(0).max(1),
  savedAt: z.string().datetime(),
});

export const readerDocumentSchema = z.object({
  document: documentSummarySchema,
  revision: z.object({
    revisionId: z.string().min(1),
    format: documentFormatDescriptorSchema,
    capabilities: documentCapabilitiesSchema,
  }),
  renderHtml: z.string(),
  blocks: z.array(semanticBlockSchema),
  outline: z.array(outlineEntrySchema),
  progress: readingProgressSchema.nullable(),
});

export const readerDocumentQuerySchema = z.object({
  revisionId: z.string().min(1).optional(),
});

export const updateReadingProgressRequestSchema = z.object({
  revisionId: z.string().min(1),
  blockId: z.string().min(1),
  offset: z.number().int().nonnegative(),
  progression: z.number().min(0).max(1),
});

export type SemanticBlockType = z.infer<typeof semanticBlockTypeSchema>;
export type SourceRange = z.infer<typeof sourceRangeSchema>;
export type SemanticBlock = z.infer<typeof semanticBlockSchema>;
export type OutlineEntry = z.infer<typeof outlineEntrySchema>;
export type ReadingProgress = z.infer<typeof readingProgressSchema>;
export type ReaderDocument = z.infer<typeof readerDocumentSchema>;
export type ReaderDocumentQuery = z.infer<typeof readerDocumentQuerySchema>;
export type UpdateReadingProgressRequest = z.infer<typeof updateReadingProgressRequestSchema>;
