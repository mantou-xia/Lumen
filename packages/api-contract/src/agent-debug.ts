import { z } from "zod";

export const agentDebugReferenceSchema = z.object({
  label: z.string().min(1),
  content: z.string(),
  source: z.string(),
});

export const agentDebugLogSchema = z.object({
  sequence: z.number().int().positive(),
  level: z.enum(["debug", "info", "warn", "error"]),
  stage: z.string().min(1),
  message: z.string(),
  data: z.unknown().nullable(),
  createdAt: z.string().datetime(),
});

export const agentDebugTraceSchema = z.object({
  traceId: z.string().min(1),
  operationId: z.string().min(1).nullable(),
  invocationId: z.string().min(1).nullable(),
  taskType: z.string().min(1).nullable(),
  taskVersion: z.string().min(1).nullable(),
  promptVersion: z.string().min(1).nullable(),
  contextPolicy: z.string().min(1).nullable(),
  status: z.enum(["running", "succeeded", "failed"]),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  systemPrompt: z.string(),
  userPrompt: z.string(),
  context: z.string(),
  references: z.array(agentDebugReferenceSchema),
  metadata: z.record(z.string(), z.unknown()),
  actualRequest: z.record(z.string(), z.unknown()),
  rawResponse: z.unknown().nullable(),
  output: z.string().nullable(),
  reasoning: z.string().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  finishReason: z.string().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  errorName: z.string().nullable(),
  errorMessage: z.string().nullable(),
  errorStack: z.string().nullable(),
  errorCause: z.unknown().nullable(),
  logs: z.array(agentDebugLogSchema),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export const agentDebugTraceSummarySchema = agentDebugTraceSchema.pick({
  traceId: true,
  operationId: true,
  invocationId: true,
  taskType: true,
  taskVersion: true,
  status: true,
  providerId: true,
  modelId: true,
  latencyMs: true,
  errorMessage: true,
  createdAt: true,
  completedAt: true,
});

export const agentDebugTraceListSchema = z.object({ traces: z.array(agentDebugTraceSummarySchema) });

export type AgentDebugTrace = z.infer<typeof agentDebugTraceSchema>;
export type AgentDebugTraceSummary = z.infer<typeof agentDebugTraceSummarySchema>;
