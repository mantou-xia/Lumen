import type {
  RecallEvaluation,
  RecallMatch,
  RecallOccurrence,
  RecallMatchesRequest,
} from "@lumen/api-contract";

import { ApplicationError } from "./errors.js";
import type { RecallApplicationDependencies } from "./ports.js";

export class RecallApplication {
  constructor(private readonly dependencies: RecallApplicationDependencies) {}

  findMatches(documentId: string, input: RecallMatchesRequest): RecallMatch[] {
    const document = this.dependencies.documents.getDocument(documentId);
    if (document?.activeRevisionId !== input.revisionId) {
      throw new ApplicationError({
        code: "RECALL_MATCH_INVALID",
        message: "Recall 范围不属于文档当前版本",
        statusCode: 409,
      });
    }
    return this.dependencies.repository.findMatches(input.revisionId, input.blockIds);
  }

  open(revisionId: string, match: RecallMatch): RecallOccurrence {
    const validated = this.dependencies.repository.validateMatch(revisionId, match);
    if (validated === null) {
      throw new ApplicationError({
        code: "RECALL_MATCH_INVALID",
        message: "Recall 命中已失效，请刷新阅读页面",
        statusCode: 409,
      });
    }
    return this.dependencies.transaction.run(() =>
      this.dependencies.repository.findOrCreateOccurrence({
        occurrenceId: this.dependencies.ids.generate(),
        documentId: validated.documentId,
        revisionId,
        match,
        currentContext: validated.currentContext,
        now: this.dependencies.clock.now(),
      }),
    );
  }

  async evaluate(occurrenceId: string, userInterpretation: string): Promise<RecallEvaluation> {
    const occurrence = this.dependencies.repository.getOccurrence(occurrenceId);
    if (occurrence === null) {
      throw new ApplicationError({
        code: "RECALL_OCCURRENCE_NOT_FOUND",
        message: "未找到这次 Recall 记录",
        statusCode: 404,
      });
    }
    const operationId = this.dependencies.ids.generate();
    const now = this.dependencies.clock.now();
    this.dependencies.transaction.run(() => {
      this.dependencies.operations.createOperation({
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
      this.dependencies.operations.markOperationRunning(operationId, now);
    });

    try {
      const output = await this.dependencies.runtime.executeRecall({
        operationId,
        expression: occurrence.canonicalForm,
        currentContext: occurrence.currentContext,
        historicalMeaning: occurrence.historicalMeaning,
        userInterpretation,
      });
      const result: RecallEvaluation = {
        recallAttemptId: this.dependencies.ids.generate(),
        occurrenceId,
        operationId,
        userInterpretation,
        ...output,
        createdAt: this.dependencies.clock.now(),
      };
      this.dependencies.transaction.run(() => {
        this.dependencies.repository.saveAttempt(result);
        this.dependencies.operations.completeOperation(operationId, result.createdAt);
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
      this.dependencies.transaction.run(() => this.dependencies.operations.failOperation(
        operationId,
        applicationError.code,
        applicationError.message,
        this.dependencies.clock.now(),
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
