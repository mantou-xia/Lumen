import { z } from "zod";

export const recallMatchesRequestSchema = z.object({
  revisionId: z.string().min(1),
  blockIds: z.array(z.string().min(1)).min(1).max(100),
});

export const recallMatchSchema = z.object({
  expressionId: z.string().min(1),
  canonicalForm: z.string().min(1),
  matchedVariantId: z.string().min(1),
  blockId: z.string().min(1),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
  surfaceForm: z.string().min(1),
  matchType: z.enum(["exact", "case_insensitive", "registered_variant"]),
});

export const recallMatchListSchema = z.object({ matches: z.array(recallMatchSchema) });

export const openRecallRequestSchema = z.object({
  revisionId: z.string().min(1),
  match: recallMatchSchema,
});

export const recallOccurrenceSchema = z.object({
  occurrenceId: z.string().min(1),
  documentId: z.string().min(1),
  revisionId: z.string().min(1),
  expressionId: z.string().min(1),
  blockId: z.string().min(1),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
  surfaceForm: z.string().min(1),
  currentContext: z.string().min(1),
  createdAt: z.string().datetime(),
});

export const evaluateRecallRequestSchema = z.object({
  userInterpretation: z.string().trim().min(1).max(2000),
});

export const recallEvaluationSchema = z.object({
  recallAttemptId: z.string().min(1),
  occurrenceId: z.string().min(1),
  operationId: z.string().min(1),
  userInterpretation: z.string().min(1),
  verdict: z.enum(["understood", "partially_understood", "misunderstood"]),
  feedback: z.string().min(1),
  contextualMeaning: z.string().min(1),
  missingPoints: z.array(z.string()),
  createdAt: z.string().datetime(),
});

export type RecallMatchesRequest = z.infer<typeof recallMatchesRequestSchema>;
export type RecallMatch = z.infer<typeof recallMatchSchema>;
export type OpenRecallRequest = z.infer<typeof openRecallRequestSchema>;
export type RecallOccurrence = z.infer<typeof recallOccurrenceSchema>;
export type EvaluateRecallRequest = z.infer<typeof evaluateRecallRequestSchema>;
export type RecallEvaluation = z.infer<typeof recallEvaluationSchema>;
