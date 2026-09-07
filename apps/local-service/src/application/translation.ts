import { randomUUID } from "node:crypto";

import type {
  ProviderStatus,
  TranslateSelectionRequest,
  TranslationResult,
} from "@lumen/api-contract";

import type { ControlledTaskRuntime } from "../agent-runtime/controlled-task-runtime.js";
import { SelectionService } from "../content/selection-service.js";
import { TranslationRepository } from "../content/translation-repository.js";
import type { LumenDatabase } from "../infrastructure/database/database.js";
import { RuntimeRepository } from "../infrastructure/runtime/runtime-repository.js";
import { ApplicationError } from "./errors.js";

export class TranslationApplication {
  private readonly selectionService: SelectionService;
  private readonly translations: TranslationRepository;
  private readonly operations: RuntimeRepository;

  constructor(
    private readonly database: LumenDatabase,
    private readonly runtime: ControlledTaskRuntime,
  ) {
    this.selectionService = new SelectionService(database.connection);
    this.translations = new TranslationRepository(database.connection);
    this.operations = new RuntimeRepository(database.connection);
  }

  providerStatus(): ProviderStatus {
    return {
      configured: this.runtime.provider.configured,
      provider: this.runtime.provider.providerId,
      model: this.runtime.provider.modelId === "unconfigured" ? null : this.runtime.provider.modelId,
      baseUrl: this.runtime.provider.baseUrl,
    };
  }

  async translate(documentId: string, input: TranslateSelectionRequest): Promise<TranslationResult> {
    const { selection, surroundingContext } = this.selectionService.normalize(documentId, input);
    const operationId = randomUUID();
    const createdAt = new Date().toISOString();
    this.database.transaction(() => {
      this.operations.createOperation({
        operationId,
        taskType: "selection.translation",
        taskVersion: "selection.translation.v1",
        documentId,
        revisionId: selection.revisionId,
        contextSnapshot: JSON.stringify({
          schemaVersion: 1,
          type: "selection.translation.context",
          payload: { selection, surroundingContext },
        }),
        now: createdAt,
      });
      this.operations.markOperationRunning(operationId, createdAt);
    });

    try {
      const output = await this.runtime.executeTranslation({
        operationId,
        selectedText: selection.selectedText,
        surroundingContext,
      });
      const result: TranslationResult = {
        translationId: randomUUID(),
        operationId,
        selection,
        surroundingContext,
        ...output,
        createdAt: new Date().toISOString(),
      };
      this.database.transaction(() => {
        this.translations.save(result);
        this.operations.completeOperation(operationId, result.createdAt);
      });
      return result;
    } catch (error) {
      const applicationError =
        error instanceof ApplicationError
          ? error
          : new ApplicationError({
              code: "MODEL_PROVIDER_FAILED",
              message: "翻译任务执行失败",
              retryable: true,
              statusCode: 502,
              cause: error,
            });
      this.database.transaction(() => {
        this.operations.failOperation(
          operationId,
          applicationError.code,
          applicationError.message,
          new Date().toISOString(),
        );
      });
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
