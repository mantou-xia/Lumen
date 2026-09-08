import type {
  ProviderStatus,
  TranslateSelectionRequest,
  TranslationRangeQuery,
  TranslationRangeSummary,
  TranslationResult,
} from "@lumen/api-contract";

import { ApplicationError } from "./errors.js";
import type { TranslationApplicationDependencies } from "./ports.js";
import { providerStatus } from "./ports.js";

export class TranslationApplication {
  constructor(private readonly dependencies: TranslationApplicationDependencies) {}

  providerStatus(): ProviderStatus {
    return providerStatus(this.dependencies.runtime.provider);
  }

  getResult(translationId: string): TranslationResult {
    const result = this.dependencies.translations.getById(translationId);
    if (result === null) throw this.notFound();
    return result;
  }

  listRanges(documentId: string, input: TranslationRangeQuery): TranslationRangeSummary[] {
    return this.dependencies.translations.listRanges(documentId, input);
  }

  async translate(
    documentId: string,
    input: TranslateSelectionRequest,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    const selectionId = this.dependencies.ids.generate();
    const { selection, surroundingContext } = this.dependencies.selection.normalize(
      documentId,
      input,
      selectionId,
    );
    const cached = this.dependencies.translations.findByFingerprint(
      selection.revisionId,
      selection.fingerprint,
    );
    if (cached !== null) {
      this.dependencies.operations.recordCacheHit({
        sourceOperationId: cached.operationId,
        taskType: "selection.translation",
        taskVersion: "selection.translation.v1",
        cacheKey: selection.fingerprint,
        hitAt: this.dependencies.clock.now(),
      });
      return cached;
    }
    return this.execute(selection, surroundingContext, signal);
  }

  async retry(translationId: string, signal?: AbortSignal): Promise<TranslationResult> {
    const previous = this.dependencies.translations.getById(translationId);
    if (previous === null) throw this.notFound();
    return this.execute(
      { ...previous.selection, selectionId: this.dependencies.ids.generate() },
      previous.surroundingContext,
      signal,
      previous.operationId,
    );
  }

  private async execute(
    selection: TranslationResult["selection"],
    surroundingContext: string,
    signal?: AbortSignal,
    previousOperationId?: string,
  ): Promise<TranslationResult> {
    const operationId = this.dependencies.ids.generate();
    const createdAt = this.dependencies.clock.now();
    this.dependencies.transaction.run(() => {
      this.dependencies.operations.createOperation({
        operationId,
        taskType: "selection.translation",
        taskVersion: "selection.translation.v1",
        documentId: selection.documentId,
        revisionId: selection.revisionId,
        contextSnapshot: JSON.stringify({
          schemaVersion: 1,
          type: "selection.translation.context",
          payload: { selection, surroundingContext },
        }),
        ...(previousOperationId === undefined ? {} : { previousOperationId }),
        cacheKey: selection.fingerprint,
        now: createdAt,
      });
      this.dependencies.operations.markOperationRunning(operationId, createdAt);
    });

    try {
      const output = await this.dependencies.runtime.executeTranslation({
        operationId,
        selectedText: selection.selectedText,
        surroundingContext,
        ...(signal === undefined ? {} : { signal }),
      });
      const result: TranslationResult = {
        translationId: this.dependencies.ids.generate(),
        operationId,
        selection,
        surroundingContext,
        ...output,
        createdAt: this.dependencies.clock.now(),
      };
      this.dependencies.transaction.run(() => {
        this.dependencies.translations.save(result);
        this.dependencies.operations.completeOperation(operationId, result.createdAt);
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
      this.dependencies.transaction.run(() => {
        if (applicationError.code === "OPERATION_CANCELLED") {
          this.dependencies.operations.cancelOperation(operationId, this.dependencies.clock.now());
        } else {
          this.dependencies.operations.failOperation(
            operationId,
            applicationError.code,
            applicationError.message,
            this.dependencies.clock.now(),
          );
        }
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

  private notFound(): ApplicationError {
    return new ApplicationError({
      code: "TRANSLATION_NOT_FOUND",
      message: "翻译结果不存在",
      statusCode: 404,
    });
  }
}
