import { randomUUID } from "node:crypto";

import type {
  RecallEvaluation,
  RecallMatch,
  RecallOccurrence,
  RecallMatchesRequest,
} from "@lumen/api-contract";

import type { ControlledTaskRuntime } from "../agent-runtime/controlled-task-runtime.js";
import type { LumenDatabase } from "../infrastructure/database/database.js";
import { RuntimeRepository } from "../infrastructure/runtime/runtime-repository.js";
import { RecallRepository } from "../learning/recall-repository.js";
import { ApplicationError } from "./errors.js";

export class RecallApplication {
  private readonly repository: RecallRepository;
  private readonly operations: RuntimeRepository;

  constructor(
    private readonly database: LumenDatabase,
    private readonly runtime: ControlledTaskRuntime,
  ) {
    this.repository = new RecallRepository(database.connection);
    this.operations = new RuntimeRepository(database.connection);
  }

  findMatches(documentId: string, input: RecallMatchesRequest): RecallMatch[] {
    const activeRevision = this.database.connection
      .prepare("SELECT active_revision_id FROM documents WHERE id = ? AND status = 'ready'")
      .get(documentId) as { active_revision_id: string } | undefined;
    if (activeRevision?.active_revision_id !== input.revisionId) {
      throw new ApplicationError({
        code: "RECALL_MATCH_INVALID",
        message: "Recall 范围不属于文档当前版本",
        statusCode: 409,
      });
    }
    return this.repository.findMatches(input.revisionId, input.blockIds);
  }

  open(revisionId: string, match: RecallMatch): RecallOccurrence {
    const validated = this.repository.validateMatch(revisionId, match);
    if (validated === null) {
      throw new ApplicationError({
        code: "RECALL_MATCH_INVALID",
        message: "Recall 命中已失效，请刷新阅读页面",
        statusCode: 409,
      });
    }
    return this.database.transaction(() =>
      this.repository.findOrCreateOccurrence({
        occurrenceId: randomUUID(),
        documentId: validated.documentId,
        revisionId,
        match,
        currentContext: validated.currentContext,
        now: new Date().toISOString(),
      }),
    );
  }

  async evaluate(occurrenceId: string, userInterpretation: string): Promise<RecallEvaluation> {
    const occurrence = this.repository.getOccurrence(occurrenceId);
    if (occurrence === null) {
      throw new ApplicationError({
        code: "RECALL_OCCURRENCE_NOT_FOUND",
        message: "未找到这次 Recall 记录",
        statusCode: 404,
      });
    }
    const operationId = randomUUID();
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.operations.createOperation({
        operationId,
        taskType: "recall.evaluation",
        taskVersion: "recall.evaluation.v1",
        documentId: occurrence.documentId,
        revisionId: occurrence.revisionId,
        contextSnapshot: JSON.stringify({
          schemaVersion: 1,
          type: "recall.evaluation.context",
          payload: { occurrence, userInterpretation },
        }),
        now,
      });
      this.operations.markOperationRunning(operationId, now);
    });

    try {
      const output = await this.runtime.executeRecall({
        operationId,
        expression: occurrence.canonicalForm,
        currentContext: occurrence.currentContext,
        historicalMeaning: occurrence.historicalMeaning,
        userInterpretation,
      });
      const result: RecallEvaluation = {
        recallAttemptId: randomUUID(),
        occurrenceId,
        operationId,
        userInterpretation,
        ...output,
        createdAt: new Date().toISOString(),
      };
      this.database.transaction(() => {
        this.repository.saveAttempt(result);
        this.operations.completeOperation(operationId, result.createdAt);
      });
      return result;
    } catch (error) {
      const applicationError = error instanceof ApplicationError
        ? error
        : new ApplicationError({
            code: "MODEL_PROVIDER_FAILED",
            message: "Recall 判断执行失败",
            retryable: true,
            statusCode: 502,
            cause: error,
          });
      this.database.transaction(() => this.operations.failOperation(
        operationId,
        applicationError.code,
        applicationError.message,
        new Date().toISOString(),
      ));
      throw new ApplicationError({
        code: applicationError.code,
        message: applicationError.message,
        retryable: applicationError.retryable,
        operationId,
        statusCode: applicationError.statusCode,
        cause: applicationError,
      });
    }
  }
}
