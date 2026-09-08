import { z } from "zod";

import { semanticPointSchema, selectionSourceRangeSchema } from "./translation.js";

export const annotationStatusSchema = z.enum(["active", "archived"]);

export const annotationSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("selection") }),
  z.object({ type: z.literal("translation"), translationId: z.string().min(1) }),
  z.object({ type: z.literal("learning_context"), learningContextId: z.string().min(1) }),
]);

export const createAnnotationRequestSchema = z.object({
  revisionId: z.string().min(1),
  start: semanticPointSchema,
  end: semanticPointSchema,
  selectedText: z.string().min(1).max(2000),
  note: z.string().max(10_000).default(""),
  source: annotationSourceSchema.default({ type: "selection" }),
});

export const annotationSchema = z.object({
  annotationId: z.string().min(1),
  documentId: z.string().min(1),
  revisionId: z.string().min(1),
  start: semanticPointSchema,
  end: semanticPointSchema,
  selectedText: z.string().min(1),
  sourceRanges: z.array(selectionSourceRangeSchema).min(1),
  note: z.string(),
  source: annotationSourceSchema,
  status: annotationStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const annotationRangeQuerySchema = z.object({
  revisionId: z.string().min(1),
  blockIds: z.array(z.string().min(1)).min(1).max(100),
});

export const annotationListSchema = z.object({ annotations: z.array(annotationSchema) });
export const updateAnnotationRequestSchema = z.object({ note: z.string().max(10_000) });

export type AnnotationStatus = z.infer<typeof annotationStatusSchema>;
export type AnnotationSource = z.infer<typeof annotationSourceSchema>;
export type CreateAnnotationRequest = z.infer<typeof createAnnotationRequestSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type AnnotationRangeQuery = z.infer<typeof annotationRangeQuerySchema>;
export type UpdateAnnotationRequest = z.infer<typeof updateAnnotationRequestSchema>;
