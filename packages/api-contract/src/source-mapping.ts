import { z } from "zod";

export const sourceMappingSchema = z.object({
  mappingId: z.string().min(1),
  revisionId: z.string().min(1),
  blockId: z.string().min(1),
  mappingKind: z.string().min(1),
  semanticStartOffset: z.number().int().nonnegative(),
  semanticEndOffset: z.number().int().nonnegative(),
  sourceStartOffset: z.number().int().nonnegative(),
  sourceEndOffset: z.number().int().nonnegative(),
});

export const semanticMappingQuerySchema = z.object({
  blockId: z.string().min(1),
  offset: z.number().int().nonnegative(),
});

export const sourceMappingQuerySchema = z.object({
  sourceOffset: z.number().int().nonnegative(),
});

export const sourceMappingListSchema = z.object({ mappings: z.array(sourceMappingSchema) });

export type SourceMapping = z.infer<typeof sourceMappingSchema>;
export type SemanticMappingQuery = z.infer<typeof semanticMappingQuerySchema>;
export type SourceMappingQuery = z.infer<typeof sourceMappingQuerySchema>;
