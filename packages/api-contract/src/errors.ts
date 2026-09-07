import { z } from "zod";

export const applicationErrorCodeSchema = z.enum([
  "DOCUMENT_FORMAT_UNSUPPORTED",
  "DOCUMENT_SOURCE_INVALID",
  "DOCUMENT_SOURCE_TOO_LARGE",
  "DOCUMENT_NOT_FOUND",
  "DOCUMENT_PROJECTION_UNAVAILABLE",
  "READING_POSITION_INVALID",
  "SELECTION_INVALID",
  "MODEL_PROVIDER_NOT_CONFIGURED",
  "MODEL_PROVIDER_FAILED",
  "MODEL_OUTPUT_INVALID",
  "TRANSLATION_NOT_FOUND",
  "LEARNING_ITEM_INVALID",
  "RECALL_MATCH_INVALID",
  "RECALL_OCCURRENCE_NOT_FOUND",
  "IMPORT_OPERATION_NOT_FOUND",
  "OPERATION_INTERRUPTED",
  "IMPORT_FAILED",
  "INTERNAL_ERROR",
]);

export const applicationErrorSchema = z.object({
  code: applicationErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  operationId: z.string().min(1).optional(),
  traceId: z.string().min(1),
});

export type ApplicationErrorCode = z.infer<typeof applicationErrorCodeSchema>;
export type ApplicationError = z.infer<typeof applicationErrorSchema>;
