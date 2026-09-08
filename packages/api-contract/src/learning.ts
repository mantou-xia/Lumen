import { z } from "zod";

import { lexicalLocalizationSchema, lexicalProfileSchema } from "./lexical.js";
import { expressionTypeSchema } from "./translation.js";

export const expressionStatusSchema = z.enum(["active", "familiar", "archived"]);
export const learningContextStatusSchema = z.enum(["active", "archived"]);

export const saveLearningItemRequestSchema = z.object({
  translationId: z.string().min(1),
});

export const learningContextSchema = z.object({
  learningContextId: z.string().min(1),
  expressionId: z.string().min(1),
  documentId: z.string().min(1),
  revisionId: z.string().min(1),
  startBlockId: z.string().min(1),
  startOffset: z.number().int().nonnegative(),
  endBlockId: z.string().min(1),
  endOffset: z.number().int().nonnegative(),
  surfaceForm: z.string().min(1),
  surroundingContext: z.string().min(1),
  contextualTranslation: z.string().min(1),
  contextualMeaning: z.string().min(1),
  translationOperationId: z.string().min(1),
  createdAt: z.string().datetime(),
});

export const learningItemSchema = z.object({
  expressionId: z.string().min(1),
  canonicalForm: z.string().min(1),
  normalizedForm: z.string().min(1),
  expressionType: expressionTypeSchema,
  status: expressionStatusSchema,
  contexts: z.array(learningContextSchema).min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const learningItemListSchema = z.object({ items: z.array(learningItemSchema) });

export const learningListSortSchema = z.enum([
  "updated_desc",
  "canonical_asc",
  "context_count_desc",
]);

export const learningListQuerySchema = z.object({
  query: z.string().trim().default(""),
  expressionType: expressionTypeSchema.optional(),
  status: expressionStatusSchema.optional(),
  sourceDocumentId: z.string().min(1).optional(),
  sort: learningListSortSchema.default("updated_desc"),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const learningContextSummarySchema = z.object({
  learningContextId: z.string().min(1),
  documentId: z.string().min(1),
  documentTitle: z.string().min(1),
  revisionId: z.string().min(1),
  surfaceForm: z.string().min(1),
  surroundingContext: z.string().min(1),
  contextualTranslation: z.string().min(1),
  contextualMeaning: z.string().min(1),
  createdAt: z.string().datetime(),
});

export const learningExpressionSummarySchema = z.object({
  expressionId: z.string().min(1),
  canonicalForm: z.string().min(1),
  normalizedForm: z.string().min(1),
  expressionType: expressionTypeSchema,
  status: expressionStatusSchema,
  userNote: z.string(),
  stableMeaning: z.string().min(1).nullable(),
  pronunciation: z.string().min(1).nullable(),
  audioUrl: z.string().url().nullable(),
  partsOfSpeech: z.array(z.string().min(1)),
  latestContext: learningContextSummarySchema.nullable(),
  contextCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const learningExpressionListSchema = z.object({
  items: z.array(learningExpressionSummarySchema),
  nextCursor: z.string().min(1).nullable(),
  totalExpressions: z.number().int().nonnegative(),
  totalContexts: z.number().int().nonnegative(),
});

export const learningContextDetailSchema = z.object({
  learningContextId: z.string().min(1),
  expressionId: z.string().min(1),
  translationId: z.string().min(1),
  documentId: z.string().min(1),
  documentTitle: z.string().min(1),
  revisionId: z.string().min(1),
  locationLabel: z.string().min(1),
  startBlockId: z.string().min(1),
  startOffset: z.number().int().nonnegative(),
  endBlockId: z.string().min(1),
  endOffset: z.number().int().nonnegative(),
  surfaceForm: z.string().min(1),
  surroundingContext: z.string().min(1),
  contextualTranslation: z.string().min(1),
  contextualMeaning: z.string().min(1),
  explanation: z.string(),
  uncertainty: z.string(),
  translationOperationId: z.string().min(1),
  status: learningContextStatusSchema,
  userNote: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const learningContextSortSchema = z.enum(["newest", "oldest"]);
export const learningExpressionDetailQuerySchema = z.object({
  contextSort: learningContextSortSchema.default("newest"),
});

export const learningExpressionDetailSchema = z.object({
  expressionId: z.string().min(1),
  canonicalForm: z.string().min(1),
  normalizedForm: z.string().min(1),
  expressionType: expressionTypeSchema,
  status: expressionStatusSchema,
  userNote: z.string(),
  lexicalProfile: lexicalProfileSchema.nullable(),
  lexicalLocalization: lexicalLocalizationSchema.nullable(),
  contexts: z.array(learningContextDetailSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const updateExpressionStatusRequestSchema = z.object({ status: expressionStatusSchema });
export const updateLearningNoteRequestSchema = z.object({ note: z.string().max(10_000) });

export type SaveLearningItemRequest = z.infer<typeof saveLearningItemRequestSchema>;
export type LearningContext = z.infer<typeof learningContextSchema>;
export type LearningItem = z.infer<typeof learningItemSchema>;
export type ExpressionStatus = z.infer<typeof expressionStatusSchema>;
export type LearningContextStatus = z.infer<typeof learningContextStatusSchema>;
export type LearningListSort = z.infer<typeof learningListSortSchema>;
export type LearningListQuery = z.infer<typeof learningListQuerySchema>;
export type LearningContextSummary = z.infer<typeof learningContextSummarySchema>;
export type LearningExpressionSummary = z.infer<typeof learningExpressionSummarySchema>;
export type LearningExpressionList = z.infer<typeof learningExpressionListSchema>;
export type LearningContextDetail = z.infer<typeof learningContextDetailSchema>;
export type LearningContextSort = z.infer<typeof learningContextSortSchema>;
export type LearningExpressionDetail = z.infer<typeof learningExpressionDetailSchema>;
export type UpdateExpressionStatusRequest = z.infer<typeof updateExpressionStatusRequestSchema>;
export type UpdateLearningNoteRequest = z.infer<typeof updateLearningNoteRequestSchema>;
