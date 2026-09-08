import { z } from "zod";

export const semanticPointSchema = z.object({
  blockId: z.string().min(1),
  offset: z.number().int().nonnegative(),
});

export const selectionSourceRangeSchema = z.object({
  blockId: z.string().min(1),
  semanticStartOffset: z.number().int().nonnegative(),
  semanticEndOffset: z.number().int().nonnegative(),
  source: z.object({
    kind: z.string().min(1),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().nonnegative(),
  }),
});

export const semanticSelectionSchema = z.object({
  selectionId: z.string().min(1),
  documentId: z.string().min(1),
  revisionId: z.string().min(1),
  start: semanticPointSchema,
  end: semanticPointSchema,
  selectedText: z.string().min(1),
  sourceRanges: z.array(selectionSourceRangeSchema).min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

export const translateSelectionRequestSchema = z.object({
  revisionId: z.string().min(1),
  start: semanticPointSchema,
  end: semanticPointSchema,
  selectedText: z.string().min(1).max(2000),
});

export const expressionTypeSchema = z.enum(["word", "phrase", "collocation", "sentence"]);

export const translationResultSchema = z.object({
  translationId: z.string().min(1),
  operationId: z.string().min(1),
  selection: semanticSelectionSchema,
  contextualTranslation: z.string().min(1),
  contextualMeaning: z.string().min(1),
  expressionType: expressionTypeSchema,
  explanation: z.string(),
  uncertainty: z.string(),
  surroundingContext: z.string().min(1),
  createdAt: z.string().datetime(),
});

export const translationRangeQuerySchema = z.object({
  revisionId: z.string().min(1),
  blockIds: z.array(z.string().min(1)).min(1).max(100),
});

export const translationRangeSummarySchema = z.object({
  translationId: z.string().min(1),
  operationId: z.string().min(1),
  revisionId: z.string().min(1),
  start: semanticPointSchema,
  end: semanticPointSchema,
  selectedText: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
});

export const translationRangeListSchema = z.object({
  ranges: z.array(translationRangeSummarySchema),
});

export const providerStatusSchema = z.object({
  configured: z.boolean(),
  provider: z.enum(["deepseek", "openai-compatible"]),
  model: z.string().min(1).nullable(),
  baseUrl: z.string().min(1).nullable(),
});

export type SemanticPoint = z.infer<typeof semanticPointSchema>;
export type SemanticSelection = z.infer<typeof semanticSelectionSchema>;
export type SelectionSourceRange = z.infer<typeof selectionSourceRangeSchema>;
export type TranslateSelectionRequest = z.infer<typeof translateSelectionRequestSchema>;
export type ExpressionType = z.infer<typeof expressionTypeSchema>;
export type TranslationResult = z.infer<typeof translationResultSchema>;
export type TranslationRangeQuery = z.infer<typeof translationRangeQuerySchema>;
export type TranslationRangeSummary = z.infer<typeof translationRangeSummarySchema>;
export type ProviderStatus = z.infer<typeof providerStatusSchema>;
