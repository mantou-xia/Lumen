import { z } from "zod";

import { semanticPointSchema } from "./translation.js";

export const anchoredAssistResultTypeSchema = z.enum(["translation", "explanation"]);

const anchoredAssistRelatedResultSchema = z.discriminatedUnion("resultType", [
  z.object({
    resultId: z.string().min(1),
    resultType: z.literal("translation"),
    translationId: z.string().min(1),
    operationId: z.string().min(1),
  }),
  z.object({
    resultId: z.string().min(1),
    resultType: z.literal("explanation"),
    footnoteId: z.string().min(1),
    conversationId: z.string().min(1),
    turnId: z.string().min(1),
    capabilityId: z.string().min(1),
  }),
]);

const anchoredAssistResultBaseSchema = z.object({
  resultId: z.string().min(1),
  resultType: anchoredAssistResultTypeSchema,
  documentId: z.string().min(1),
  revisionId: z.string().min(1),
  selectionFingerprint: z.string().min(1),
  selectedText: z.string().min(1),
  start: semanticPointSchema,
  end: semanticPointSchema,
  createdAt: z.string().datetime(),
  relatedResult: anchoredAssistRelatedResultSchema.nullable(),
});

export const anchoredAssistResultSchema = z.discriminatedUnion("resultType", [
  anchoredAssistResultBaseSchema.extend({
    resultType: z.literal("translation"),
    translationId: z.string().min(1),
    operationId: z.string().min(1),
  }),
  anchoredAssistResultBaseSchema.extend({
    resultType: z.literal("explanation"),
    footnoteId: z.string().min(1),
    conversationId: z.string().min(1),
    turnId: z.string().min(1),
    capabilityId: z.string().min(1),
  }),
]);

export const anchoredAssistResultListSchema = z.array(anchoredAssistResultSchema);

export type AnchoredAssistResult = z.infer<typeof anchoredAssistResultSchema>;
export type AnchoredAssistResultType = z.infer<typeof anchoredAssistResultTypeSchema>;
