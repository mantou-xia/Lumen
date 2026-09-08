import { z } from "zod";

export const operationStatusSchema = z.enum([
  "requested",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export const invocationStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
]);

export const invocationSchema = z.object({
  invocationId: z.string().min(1),
  attemptNumber: z.number().int().positive(),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  status: invocationStatusSchema,
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  finishReason: z.string().nullable().default(null),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export const operationSchema = z.object({
  operationId: z.string().min(1),
  previousOperationId: z.string().min(1).nullable(),
  taskType: z.string().min(1),
  taskVersion: z.string().min(1),
  status: operationStatusSchema,
  documentId: z.string().min(1).nullable(),
  revisionId: z.string().min(1).nullable(),
  cacheKey: z.string().min(1).nullable(),
  cacheHitCount: z.number().int().nonnegative().default(0),
  latestSequence: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  invocations: z.array(invocationSchema),
});

export const operationEventSchema = z.object({
  operationId: z.string().min(1),
  sequence: z.number().int().positive(),
  eventType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const operationEventQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

export const operationEventListSchema = z.object({
  events: z.array(operationEventSchema),
});

export type OperationStatus = z.infer<typeof operationStatusSchema>;
export type InvocationStatus = z.infer<typeof invocationStatusSchema>;
export type Invocation = z.infer<typeof invocationSchema>;
export type Operation = z.infer<typeof operationSchema>;
export type OperationEvent = z.infer<typeof operationEventSchema>;
export type OperationEventQuery = z.infer<typeof operationEventQuerySchema>;
