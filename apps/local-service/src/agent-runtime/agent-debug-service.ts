import type { AgentDebugTrace, AgentDebugTraceSummary } from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

import type { ModelInvocationResult } from "./model-provider.js";

type DebugLog = AgentDebugTrace["logs"][number];
type RequestSnapshot = Pick<AgentDebugTrace, "systemPrompt" | "userPrompt" | "context" | "references" | "metadata" | "actualRequest"> & { logs: DebugLog[] };
type ResponseSnapshot = Pick<AgentDebugTrace, "output" | "reasoning" | "rawResponse" | "inputTokens" | "outputTokens" | "finishReason"> & { validatedOutput: unknown; logs: DebugLog[] };

interface StartTraceInput {
  operationId: string;
  invocationId: string;
  taskType: string;
  taskVersion: string;
  promptVersion: string;
  contextPolicy: string;
  providerId: string;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  contextSnapshot: string;
  rawInput: unknown;
  actualRequest: Record<string, unknown>;
  attempt: number;
}

function extractReferences(rawInput: unknown): AgentDebugTrace["references"] {
  if (typeof rawInput !== "object" || rawInput === null || !("references" in rawInput)) return [];
  const references = (rawInput as { references?: unknown }).references;
  if (!Array.isArray(references)) return [];
  return references.map((reference, index) => {
    const value = typeof reference === "object" && reference !== null ? reference as Record<string, unknown> : {};
    return {
      label: typeof value.label === "string" ? value.label : `Reference ${index + 1}`,
      content: typeof value.content === "string" ? value.content : JSON.stringify(reference),
      source: typeof value.sourceRole === "string" ? value.sourceRole : typeof value.type === "string" ? value.type : "runtime",
    };
  });
}

function serializableCause(error: Error): unknown {
  const cause = error.cause;
  if (cause === undefined) return null;
  if (cause instanceof Error) return { name: cause.name, message: cause.message, stack: cause.stack ?? null, cause: serializableCause(cause) };
  try {
    return JSON.parse(JSON.stringify(cause)) as unknown;
  } catch {
    return String(cause);
  }
}

function inputPreview(request: RequestSnapshot): string | null {
  const rawInput = request.metadata.rawInput;
  if (typeof rawInput !== "object" || rawInput === null) return null;
  const input = rawInput as Record<string, unknown>;
  const value = typeof input.selectedText === "string"
    ? input.selectedText
    : typeof input.question === "string"
      ? input.question
      : typeof input.expression === "string"
        ? input.expression
        : typeof input.profile === "object" && input.profile !== null
          ? (input.profile as Record<string, unknown>).lemma
          : null;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 77)}…`;
}

export class AgentDebugService {
  constructor(
    private readonly connection: DatabaseSync,
    private readonly generateId: () => string,
    private readonly now: () => string,
  ) {}

  start(input: StartTraceInput): string {
    const traceId = this.generateId();
    const createdAt = this.now();
    const logs: DebugLog[] = [
      { sequence: 1, level: "info", stage: "runtime.compiled", message: "已捕获正式 Runtime 编译结果", data: { operationId: input.operationId, invocationId: input.invocationId, taskType: input.taskType, taskVersion: input.taskVersion, promptVersion: input.promptVersion, contextPolicy: input.contextPolicy, attempt: input.attempt }, createdAt },
      { sequence: 2, level: "info", stage: "provider.request", message: "开始执行正式 Provider 请求", data: { providerId: input.providerId, modelId: input.modelId }, createdAt },
    ];
    const request: RequestSnapshot = {
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      context: input.contextSnapshot,
      references: extractReferences(input.rawInput),
      metadata: { rawInput: input.rawInput, attempt: input.attempt, promptVersion: input.promptVersion, contextPolicy: input.contextPolicy },
      actualRequest: input.actualRequest,
      logs,
    };
    this.connection.prepare(`
      INSERT INTO agent_debug_traces (
        trace_id, operation_id, invocation_id, task_type, task_version,
        status, provider_id, model_id, request_snapshot, created_at
      ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)
    `).run(traceId, input.operationId, input.invocationId, input.taskType, input.taskVersion, input.providerId, input.modelId, JSON.stringify(request), createdAt);
    return traceId;
  }

  complete(input: { traceId: string; result: ModelInvocationResult; validatedOutput: unknown; latencyMs: number }): void {
    const request = this.readRequest(input.traceId);
    const completedAt = this.now();
    const logs: DebugLog[] = [...request.logs, { sequence: request.logs.length + 1, level: "info", stage: "runtime.validated", message: "Provider 响应已通过 JSON 解析、结构校验与任务校验", data: { inputTokens: input.result.inputTokens, outputTokens: input.result.outputTokens, finishReason: input.result.finishReason ?? null, latencyMs: input.latencyMs }, createdAt: completedAt }];
    const response: ResponseSnapshot = { output: input.result.content, reasoning: input.result.reasoning ?? null, rawResponse: input.result.rawResponse ?? null, validatedOutput: input.validatedOutput, inputTokens: input.result.inputTokens, outputTokens: input.result.outputTokens, finishReason: input.result.finishReason ?? null, logs };
    this.connection.prepare(`UPDATE agent_debug_traces SET status = 'succeeded', request_snapshot = ?, response_snapshot = ?, latency_ms = ?, completed_at = ? WHERE trace_id = ?`)
      .run(JSON.stringify({ ...request, logs }), JSON.stringify(response), input.latencyMs, completedAt, input.traceId);
  }

  fail(input: { traceId: string; error: Error & { code?: string; retryable?: boolean }; result?: ModelInvocationResult; latencyMs: number; cancelled: boolean }): void {
    const request = this.readRequest(input.traceId);
    const completedAt = this.now();
    const cause = serializableCause(input.error);
    const logs: DebugLog[] = [...request.logs, { sequence: request.logs.length + 1, level: "error", stage: input.cancelled ? "runtime.cancelled" : "runtime.failed", message: input.error.message, data: { name: input.error.name, code: input.error.code ?? null, retryable: input.error.retryable ?? false, cause, latencyMs: input.latencyMs }, createdAt: completedAt }];
    const response: ResponseSnapshot | null = input.result === undefined ? null : {
      output: input.result.content,
      reasoning: input.result.reasoning ?? null,
      rawResponse: input.result.rawResponse ?? null,
      validatedOutput: null,
      inputTokens: input.result.inputTokens,
      outputTokens: input.result.outputTokens,
      finishReason: input.result.finishReason ?? null,
      logs,
    };
    this.connection.prepare(`UPDATE agent_debug_traces SET status = 'failed', request_snapshot = ?, response_snapshot = ?, error_snapshot = ?, latency_ms = ?, completed_at = ? WHERE trace_id = ?`)
      .run(JSON.stringify({ ...request, logs }), response === null ? null : JSON.stringify(response), JSON.stringify({ name: input.error.name, message: input.error.message, stack: input.error.stack ?? null, cause, code: input.error.code ?? null, cancelled: input.cancelled, logs }), input.latencyMs, completedAt, input.traceId);
  }

  list(): AgentDebugTraceSummary[] {
    return (this.connection.prepare(`SELECT trace_id, operation_id, invocation_id, task_type, task_version, status, provider_id, model_id, latency_ms, request_snapshot, error_snapshot, created_at, completed_at FROM agent_debug_traces ORDER BY created_at DESC LIMIT 200`).all() as unknown as Array<Record<string, unknown>>).map((row) => {
      const error = row.error_snapshot === null ? null : JSON.parse(String(row.error_snapshot)) as { message?: string };
      const request = JSON.parse(String(row.request_snapshot)) as RequestSnapshot;
      return { traceId: String(row.trace_id), operationId: row.operation_id === null ? null : String(row.operation_id), invocationId: row.invocation_id === null ? null : String(row.invocation_id), taskType: row.task_type === null ? null : String(row.task_type), taskVersion: row.task_version === null ? null : String(row.task_version), status: row.status as AgentDebugTraceSummary["status"], providerId: String(row.provider_id), modelId: String(row.model_id), latencyMs: row.latency_ms === null ? null : Number(row.latency_ms), errorMessage: error?.message ?? null, inputPreview: inputPreview(request), createdAt: String(row.created_at), completedAt: row.completed_at === null ? null : String(row.completed_at) };
    });
  }

  get(traceId: string): AgentDebugTrace {
    const row = this.connection.prepare("SELECT * FROM agent_debug_traces WHERE trace_id = ?").get(traceId) as Record<string, unknown> | undefined;
    if (row === undefined) throw new Error(`Agent Trace 不存在：${traceId}`);
    const request = JSON.parse(String(row.request_snapshot)) as RequestSnapshot;
    const response = row.response_snapshot === null ? null : JSON.parse(String(row.response_snapshot)) as ResponseSnapshot;
    const error = row.error_snapshot === null ? null : JSON.parse(String(row.error_snapshot)) as { name: string; message: string; stack: string | null; cause?: unknown; logs: DebugLog[] };
    return {
      traceId: String(row.trace_id), operationId: row.operation_id === null ? null : String(row.operation_id), invocationId: row.invocation_id === null ? null : String(row.invocation_id), taskType: row.task_type === null ? null : String(row.task_type), taskVersion: row.task_version === null ? null : String(row.task_version),
      promptVersion: typeof request.metadata.promptVersion === "string" ? request.metadata.promptVersion : null,
      contextPolicy: typeof request.metadata.contextPolicy === "string" ? request.metadata.contextPolicy : null,
      status: row.status as AgentDebugTrace["status"], providerId: String(row.provider_id), modelId: String(row.model_id), systemPrompt: request.systemPrompt, userPrompt: request.userPrompt, context: request.context, references: request.references, metadata: request.metadata, actualRequest: request.actualRequest,
      rawResponse: response?.rawResponse ?? null, output: response?.output ?? null, validatedOutput: response?.validatedOutput ?? null, reasoning: response?.reasoning ?? null, inputTokens: response?.inputTokens ?? null, outputTokens: response?.outputTokens ?? null, finishReason: response?.finishReason ?? null, latencyMs: row.latency_ms === null ? null : Number(row.latency_ms), errorName: error?.name ?? null, errorMessage: error?.message ?? null, errorStack: error?.stack ?? null, errorCause: error?.cause ?? null, logs: response?.logs ?? error?.logs ?? request.logs, createdAt: String(row.created_at), completedAt: row.completed_at === null ? null : String(row.completed_at),
    };
  }

  private readRequest(traceId: string): RequestSnapshot {
    const row = this.connection.prepare("SELECT request_snapshot FROM agent_debug_traces WHERE trace_id = ?").get(traceId) as { request_snapshot?: unknown } | undefined;
    if (row?.request_snapshot === undefined) throw new Error(`Agent Trace 不存在：${traceId}`);
    return JSON.parse(String(row.request_snapshot)) as RequestSnapshot;
  }
}
