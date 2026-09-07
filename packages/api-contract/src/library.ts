import { z } from "zod";

export const documentStatusSchema = z.enum(["ready", "archived", "unavailable"]);
export const documentFormatSchema = z.literal("markdown");

export const documentSummarySchema = z.object({
  documentId: z.string().min(1),
  activeRevisionId: z.string().min(1),
  formatId: documentFormatSchema,
  title: z.string().min(1),
  originalFilename: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  status: documentStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const documentDetailSchema = documentSummarySchema.extend({
  sourceResourceId: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const documentListResponseSchema = z.object({
  documents: z.array(documentSummarySchema),
});

export const importOperationStatusSchema = z.enum([
  "requested",
  "receiving",
  "inspecting",
  "committing",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export const importOperationSchema = z.object({
  operationId: z.string().min(1),
  status: importOperationStatusSchema,
  originalFilename: z.string().min(1),
  documentId: z.string().min(1).nullable(),
  errorCode: z.string().min(1).nullable(),
  errorMessage: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export const importDocumentResponseSchema = z.object({
  operation: importOperationSchema,
  document: documentSummarySchema,
});

export type DocumentSummary = z.infer<typeof documentSummarySchema>;
export type DocumentDetail = z.infer<typeof documentDetailSchema>;
export type DocumentListResponse = z.infer<typeof documentListResponseSchema>;
export type ImportOperationStatus = z.infer<typeof importOperationStatusSchema>;
export type ImportOperation = z.infer<typeof importOperationSchema>;
export type ImportDocumentResponse = z.infer<typeof importDocumentResponseSchema>;
