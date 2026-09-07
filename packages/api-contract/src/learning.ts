import { z } from "zod";

import { expressionTypeSchema } from "./translation.js";

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
  status: z.enum(["active", "familiar", "archived"]),
  contexts: z.array(learningContextSchema).min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const learningItemListSchema = z.object({ items: z.array(learningItemSchema) });

export type SaveLearningItemRequest = z.infer<typeof saveLearningItemRequestSchema>;
export type LearningContext = z.infer<typeof learningContextSchema>;
export type LearningItem = z.infer<typeof learningItemSchema>;
