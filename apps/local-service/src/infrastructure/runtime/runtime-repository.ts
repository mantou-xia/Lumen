import type { Operation, OperationEvent } from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

import type { RuntimeRepositoryPort } from "../../application/ports.js";

export class RuntimeRepository implements RuntimeRepositoryPort {
  constructor(private readonly connection: DatabaseSync) {}

  private recordEvent(
    operationId: string,
    eventType: string,
    payload: Record<string, unknown>,
    createdAt: string,
  ): void {
    const row = this.connection.prepare(
      "SELECT latest_sequence FROM operations WHERE id = ?",
    ).get(operationId) as { latest_sequence: number } | undefined;
    if (row === undefined) return;
    const sequence = row.latest_sequence + 1;
    this.connection.prepare(`
      INSERT INTO operation_events (
        operation_id, sequence, event_type, payload_snapshot, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      operationId,
      sequence,
      eventType,
      JSON.stringify({ schemaVersion: 1, type: eventType, payload }),
      createdAt,
    );
    this.connection.prepare(
      "UPDATE operations SET latest_sequence = ? WHERE id = ?",
    ).run(sequence, operationId);
  }

  createOperation(input: {
    operationId: string;
    taskType: string;
    taskVersion: string;
    documentId: string | null;
    revisionId: string | null;
    contextSnapshot: string;
    previousOperationId?: string;
    cacheKey?: string;
    now: string;
  }): void {
    this.connection.prepare(`
      INSERT INTO operations (
        id, task_type, task_version, status, document_id, revision_id,
        context_snapshot, previous_operation_id, cache_key, created_at, updated_at
      ) VALUES (?, ?, ?, 'requested', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.operationId,
      input.taskType,
      input.taskVersion,
      input.documentId,
      input.revisionId,
      input.contextSnapshot,
      input.previousOperationId ?? null,
      input.cacheKey ?? null,
      input.now,
      input.now,
    );
    this.recordEvent(input.operationId, "operation.requested", {
      taskType: input.taskType,
      taskVersion: input.taskVersion,
    }, input.now);
  }

  markOperationRunning(operationId: string, now: string): void {
    this.connection.prepare("UPDATE operations SET status = 'running', updated_at = ? WHERE id = ?")
      .run(now, operationId);
    this.recordEvent(operationId, "operation.running", {}, now);
  }

  completeOperation(operationId: string, now: string): void {
    this.connection.prepare(`
      UPDATE operations SET status = 'completed', updated_at = ?, completed_at = ? WHERE id = ?
    `).run(now, now, operationId);
    this.recordEvent(operationId, "operation.completed", {}, now);
  }

  failOperation(operationId: string, code: string, message: string, now: string): void {
    this.connection.prepare(`
      UPDATE operations
      SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).run(code, message, now, now, operationId);
    this.recordEvent(operationId, "operation.failed", { code }, now);
  }

  cancelOperation(operationId: string, now: string): void {
    this.connection.prepare(`
      UPDATE operations
      SET status = 'cancelled', error_code = 'OPERATION_CANCELLED',
        error_message = '操作已取消', updated_at = ?, completed_at = ?
      WHERE id = ? AND status IN ('requested', 'running')
    `).run(now, now, operationId);
    this.recordEvent(operationId, "operation.cancelled", {}, now);
  }

  recordTaskCompiled(input: {
    operationId: string;
    taskVersion: string;
    contextPolicy: string;
    contextSnapshot: string;
    compiledAt: string;
  }): void {
    this.connection.prepare(`
      UPDATE operations SET context_snapshot = ?, updated_at = ? WHERE id = ?
    `).run(input.contextSnapshot, input.compiledAt, input.operationId);
    this.recordEvent(input.operationId, "task.compiled", {
      taskVersion: input.taskVersion,
      contextPolicy: input.contextPolicy,
      compilerVersion: "context-compiler.v1",
    }, input.compiledAt);
  }

  recordCacheHit(input: {
    sourceOperationId: string;
    taskType: string;
    taskVersion: string;
    cacheKey: string;
    hitAt: string;
  }): void {
    this.connection.prepare(`
      INSERT INTO runtime_cache_hits (
        task_type, task_version, cache_key, source_operation_id, hit_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      input.taskType,
      input.taskVersion,
      input.cacheKey,
      input.sourceOperationId,
      input.hitAt,
    );
    this.recordEvent(input.sourceOperationId, "cache.hit", {
      taskType: input.taskType,
      taskVersion: input.taskVersion,
      cacheKey: input.cacheKey,
    }, input.hitAt);
  }

  startInvocation(input: {
    invocationId: string;
    operationId: string;
    providerId: string;
    modelId: string;
    startedAt: string;
  }): void {
    const attempt = this.connection.prepare(`
      SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt_number
      FROM invocations WHERE operation_id = ?
    `).get(input.operationId) as { attempt_number: number };
    this.connection.prepare(`
      INSERT INTO invocations (
        id, operation_id, attempt_number, provider_id, model_id, status, started_at
      ) VALUES (?, ?, ?, ?, ?, 'running', ?)
    `).run(
      input.invocationId,
      input.operationId,
      attempt.attempt_number,
      input.providerId,
      input.modelId,
      input.startedAt,
    );
    this.recordEvent(input.operationId, "invocation.running", {
      invocationId: input.invocationId,
      providerId: input.providerId,
      modelId: input.modelId,
      attemptNumber: attempt.attempt_number,
    }, input.startedAt);
  }

  completeInvocation(input: {
    invocationId: string;
    inputTokens: number | null;
    outputTokens: number | null;
    finishReason: string | null;
    latencyMs: number;
    completedAt: string;
  }): void {
    const operation = this.connection.prepare(
      "SELECT operation_id FROM invocations WHERE id = ?",
    ).get(input.invocationId) as { operation_id: string } | undefined;
    this.connection.prepare(`
      UPDATE invocations
      SET status = 'succeeded', input_tokens = ?, output_tokens = ?, finish_reason = ?,
        latency_ms = ?, completed_at = ?
      WHERE id = ?
    `).run(
      input.inputTokens,
      input.outputTokens,
      input.finishReason,
      input.latencyMs,
      input.completedAt,
      input.invocationId,
    );
    if (operation !== undefined) {
      this.recordEvent(operation.operation_id, "invocation.succeeded", {
        invocationId: input.invocationId,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        finishReason: input.finishReason,
        latencyMs: input.latencyMs,
      }, input.completedAt);
    }
  }

  failInvocation(input: {
    invocationId: string;
    errorCode: string;
    errorMessage: string;
    latencyMs: number;
    completedAt: string;
  }): void {
    const operation = this.connection.prepare(
      "SELECT operation_id FROM invocations WHERE id = ?",
    ).get(input.invocationId) as { operation_id: string } | undefined;
    this.connection.prepare(`
      UPDATE invocations
      SET status = 'failed', error_code = ?, error_message = ?, latency_ms = ?, completed_at = ?
      WHERE id = ?
    `).run(
      input.errorCode,
      input.errorMessage,
      input.latencyMs,
      input.completedAt,
      input.invocationId,
    );
    if (operation !== undefined) {
      this.recordEvent(operation.operation_id, "invocation.failed", {
        invocationId: input.invocationId,
        errorCode: input.errorCode,
        latencyMs: input.latencyMs,
      }, input.completedAt);
    }
  }

  cancelInvocation(input: { invocationId: string; latencyMs: number; completedAt: string }): void {
    const operation = this.connection.prepare(
      "SELECT operation_id FROM invocations WHERE id = ?",
    ).get(input.invocationId) as { operation_id: string } | undefined;
    this.connection.prepare(`
      UPDATE invocations
      SET status = 'cancelled', error_code = 'OPERATION_CANCELLED',
        error_message = 'Provider 调用已取消', latency_ms = ?, completed_at = ?
      WHERE id = ? AND status IN ('pending', 'running')
    `).run(input.latencyMs, input.completedAt, input.invocationId);
    if (operation !== undefined) {
      this.recordEvent(operation.operation_id, "invocation.cancelled", {
        invocationId: input.invocationId,
        latencyMs: input.latencyMs,
      }, input.completedAt);
    }
  }

  interruptRunningOperations(now: string): void {
    this.connection.prepare(`
      UPDATE invocations SET status = 'interrupted', completed_at = ? WHERE status IN ('pending', 'running')
    `).run(now);
    this.connection.prepare(`
      UPDATE operations
      SET status = 'interrupted', error_code = 'OPERATION_INTERRUPTED',
          error_message = 'Local Service 重启前 AI 任务未完成', updated_at = ?, completed_at = ?
      WHERE status IN ('requested', 'running')
    `).run(now, now);
  }

  getOperation(operationId: string): Operation | null {
    const operation = this.connection.prepare(`
      SELECT id, previous_operation_id, task_type, task_version, status,
        document_id, revision_id, cache_key, latest_sequence,
        (SELECT COUNT(*) FROM runtime_cache_hits WHERE source_operation_id = operations.id)
          AS cache_hit_count,
        error_code, error_message, created_at, updated_at, completed_at
      FROM operations WHERE id = ?
    `).get(operationId) as unknown as {
      id: string;
      previous_operation_id: string | null;
      task_type: string;
      task_version: string;
      status: Operation["status"];
      document_id: string | null;
      revision_id: string | null;
      cache_key: string | null;
      cache_hit_count: number;
      latest_sequence: number;
      error_code: string | null;
      error_message: string | null;
      created_at: string;
      updated_at: string;
      completed_at: string | null;
    } | undefined;
    if (operation === undefined) return null;
    const invocations = this.connection.prepare(`
      SELECT id, attempt_number, provider_id, model_id, status,
        input_tokens, output_tokens, latency_ms, finish_reason, error_code, error_message,
        started_at, completed_at
      FROM invocations WHERE operation_id = ? ORDER BY attempt_number
    `).all(operationId) as unknown as Array<{
      id: string;
      attempt_number: number;
      provider_id: string;
      model_id: string;
      status: Operation["invocations"][number]["status"];
      input_tokens: number | null;
      output_tokens: number | null;
      latency_ms: number | null;
      finish_reason: string | null;
      error_code: string | null;
      error_message: string | null;
      started_at: string;
      completed_at: string | null;
    }>;
    return {
      operationId: operation.id,
      previousOperationId: operation.previous_operation_id,
      taskType: operation.task_type,
      taskVersion: operation.task_version,
      status: operation.status,
      documentId: operation.document_id,
      revisionId: operation.revision_id,
      cacheKey: operation.cache_key,
      cacheHitCount: operation.cache_hit_count,
      latestSequence: operation.latest_sequence,
      errorCode: operation.error_code,
      errorMessage: operation.error_message,
      createdAt: operation.created_at,
      updatedAt: operation.updated_at,
      completedAt: operation.completed_at,
      invocations: invocations.map((invocation) => ({
        invocationId: invocation.id,
        attemptNumber: invocation.attempt_number,
        providerId: invocation.provider_id,
        modelId: invocation.model_id,
        status: invocation.status,
        inputTokens: invocation.input_tokens,
        outputTokens: invocation.output_tokens,
        latencyMs: invocation.latency_ms,
        finishReason: invocation.finish_reason,
        errorCode: invocation.error_code,
        errorMessage: invocation.error_message,
        startedAt: invocation.started_at,
        completedAt: invocation.completed_at,
      })),
    };
  }

  listOperationEvents(
    operationId: string,
    afterSequence: number,
    limit: number,
  ): OperationEvent[] {
    const rows = this.connection.prepare(`
      SELECT operation_id, sequence, event_type, payload_snapshot, created_at
      FROM operation_events
      WHERE operation_id = ? AND sequence > ?
      ORDER BY sequence
      LIMIT ?
    `).all(operationId, afterSequence, limit) as unknown as Array<{
      operation_id: string;
      sequence: number;
      event_type: string;
      payload_snapshot: string;
      created_at: string;
    }>;
    return rows.map((row) => {
      const snapshot = JSON.parse(row.payload_snapshot) as { payload?: Record<string, unknown> };
      return {
        operationId: row.operation_id,
        sequence: row.sequence,
        eventType: row.event_type,
        payload: snapshot.payload ?? {},
        createdAt: row.created_at,
      };
    });
  }
}
