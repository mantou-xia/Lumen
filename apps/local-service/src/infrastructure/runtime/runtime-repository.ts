import type { DatabaseSync } from "node:sqlite";

export class RuntimeRepository {
  constructor(private readonly connection: DatabaseSync) {}

  createOperation(input: {
    operationId: string;
    taskType: string;
    taskVersion: string;
    documentId: string;
    revisionId: string;
    contextSnapshot: string;
    now: string;
  }): void {
    this.connection.prepare(`
      INSERT INTO operations (
        id, task_type, task_version, status, document_id, revision_id,
        context_snapshot, created_at, updated_at
      ) VALUES (?, ?, ?, 'requested', ?, ?, ?, ?, ?)
    `).run(
      input.operationId,
      input.taskType,
      input.taskVersion,
      input.documentId,
      input.revisionId,
      input.contextSnapshot,
      input.now,
      input.now,
    );
  }

  markOperationRunning(operationId: string, now: string): void {
    this.connection.prepare("UPDATE operations SET status = 'running', updated_at = ? WHERE id = ?")
      .run(now, operationId);
  }

  completeOperation(operationId: string, now: string): void {
    this.connection.prepare(`
      UPDATE operations SET status = 'completed', updated_at = ?, completed_at = ? WHERE id = ?
    `).run(now, now, operationId);
  }

  failOperation(operationId: string, code: string, message: string, now: string): void {
    this.connection.prepare(`
      UPDATE operations
      SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).run(code, message, now, now, operationId);
  }

  startInvocation(input: {
    invocationId: string;
    operationId: string;
    providerId: string;
    modelId: string;
    startedAt: string;
  }): void {
    this.connection.prepare(`
      INSERT INTO invocations (
        id, operation_id, attempt_number, provider_id, model_id, status, started_at
      ) VALUES (?, ?, 1, ?, ?, 'running', ?)
    `).run(
      input.invocationId,
      input.operationId,
      input.providerId,
      input.modelId,
      input.startedAt,
    );
  }

  completeInvocation(input: {
    invocationId: string;
    inputTokens: number | null;
    outputTokens: number | null;
    latencyMs: number;
    completedAt: string;
  }): void {
    this.connection.prepare(`
      UPDATE invocations
      SET status = 'succeeded', input_tokens = ?, output_tokens = ?, latency_ms = ?, completed_at = ?
      WHERE id = ?
    `).run(
      input.inputTokens,
      input.outputTokens,
      input.latencyMs,
      input.completedAt,
      input.invocationId,
    );
  }

  failInvocation(input: {
    invocationId: string;
    errorCode: string;
    errorMessage: string;
    latencyMs: number;
    completedAt: string;
  }): void {
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
}
