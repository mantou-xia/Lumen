import type {
  ExpressionStatus,
  LearningContextSort,
  LearningExpressionDetail,
  LearningExpressionList,
  LearningItem,
  LearningListQuery,
} from "@lumen/api-contract";

import { normalizeExpression } from "../learning/expression-normalizer.js";
import { ApplicationError } from "./errors.js";
import type { LearningApplicationDependencies } from "./ports.js";

export class LearningApplication {
  constructor(private readonly dependencies: LearningApplicationDependencies) {}

  saveFromTranslation(translationId: string): LearningItem {
    return this.dependencies.transaction.run(() => {
      const translation = this.dependencies.repository.getCompletedTranslation(translationId);
      if (translation === null) {
        throw new ApplicationError({
          code: "TRANSLATION_NOT_FOUND",
          message: "只能收藏已经完成的翻译结果",
          statusCode: 404,
        });
      }
      const normalizedForm = normalizeExpression(translation.selectedText);
      if (normalizedForm.length === 0) {
        throw new ApplicationError({
          code: "LEARNING_ITEM_INVALID",
          message: "表达归一化后为空，无法收藏",
          statusCode: 409,
        });
      }
      const now = this.dependencies.clock.now();
      const expression = this.dependencies.repository.findUnambiguousExpression(normalizedForm)
        ?? this.dependencies.repository.createExpression({
          expressionId: this.dependencies.ids.generate(),
          canonicalForm: translation.selectedText,
          normalizedForm,
          expressionType: translation.expressionType,
          now,
        });
      if (expression.status === "archived") {
        this.dependencies.repository.updateExpressionStatus({
          historyId: this.dependencies.ids.generate(),
          expressionId: expression.expressionId,
          status: "active",
          now,
        });
      }
      this.dependencies.repository.ensureObservedVariant({
        variantId: this.dependencies.ids.generate(),
        expressionId: expression.expressionId,
        surfacePattern: translation.selectedText,
        normalizedPattern: normalizedForm,
        now,
      });
      const existing = this.dependencies.repository.findContext(
        expression.expressionId,
        translation.revisionId,
        translation.selectionFingerprint,
      );
      if (existing === null) {
        this.dependencies.repository.createContext({
          learningContextId: this.dependencies.ids.generate(),
          expressionId: expression.expressionId,
          translation,
          now,
        });
      } else {
        this.dependencies.repository.restoreContext(
          expression.expressionId,
          translation.revisionId,
          translation.selectionFingerprint,
          now,
        );
      }
      const item = this.dependencies.repository.getItem(expression.expressionId);
      if (item === null) throw new Error("收藏完成后无法读取 Learning Item");
      return item;
    });
  }

  listItems(): LearningItem[] {
    return this.dependencies.repository.listItems();
  }

  queryItems(input: LearningListQuery): LearningExpressionList {
    const offset = decodeCursor(input.cursor);
    const result = this.dependencies.repository.queryItems({ ...input, offset });
    return {
      items: result.items,
      nextCursor: result.hasMore ? encodeCursor(offset + result.items.length) : null,
      totalExpressions: result.totalExpressions,
      totalContexts: result.totalContexts,
    };
  }

  getDetails(expressionId: string, contextSort: LearningContextSort): LearningExpressionDetail {
    const details = this.dependencies.repository.getDetails(expressionId, contextSort);
    if (details === null) throw expressionNotFound();
    return details;
  }

  updateStatus(expressionId: string, status: ExpressionStatus): LearningExpressionDetail {
    return this.dependencies.transaction.run(() => {
      const updated = this.dependencies.repository.updateExpressionStatus({
        historyId: this.dependencies.ids.generate(),
        expressionId,
        status,
        now: this.dependencies.clock.now(),
      });
      if (!updated) throw expressionNotFound();
      return this.requireDetails(expressionId);
    });
  }

  updateExpressionNote(expressionId: string, note: string): LearningExpressionDetail {
    return this.dependencies.transaction.run(() => {
      const updated = this.dependencies.repository.updateExpressionNote(
        expressionId,
        note,
        this.dependencies.clock.now(),
      );
      if (!updated) throw expressionNotFound();
      return this.requireDetails(expressionId);
    });
  }

  updateContextNote(expressionId: string, contextId: string, note: string): LearningExpressionDetail {
    return this.dependencies.transaction.run(() => {
      const updated = this.dependencies.repository.updateContextNote(
        expressionId,
        contextId,
        note,
        this.dependencies.clock.now(),
      );
      if (!updated) throw contextNotFound();
      return this.requireDetails(expressionId);
    });
  }

  archiveContext(expressionId: string, contextId: string): LearningExpressionDetail {
    return this.dependencies.transaction.run(() => {
      const archived = this.dependencies.repository.archiveContext(
        expressionId,
        contextId,
        this.dependencies.clock.now(),
      );
      if (!archived) throw contextNotFound();
      return this.requireDetails(expressionId);
    });
  }

  private requireDetails(expressionId: string): LearningExpressionDetail {
    const details = this.dependencies.repository.getDetails(expressionId, "newest");
    if (details === null) throw expressionNotFound();
    return details;
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    if (!Number.isInteger(value.offset) || Number(value.offset) < 0) throw new Error("invalid offset");
    return Number(value.offset);
  } catch (error) {
    throw new ApplicationError({
      code: "LEARNING_ITEM_INVALID",
      message: "学习库分页游标无效",
      statusCode: 400,
      cause: error,
    });
  }
}

function expressionNotFound(): ApplicationError {
  return new ApplicationError({
    code: "EXPRESSION_NOT_FOUND",
    message: "未找到指定表达",
    statusCode: 404,
  });
}

function contextNotFound(): ApplicationError {
  return new ApplicationError({
    code: "LEARNING_CONTEXT_NOT_FOUND",
    message: "未找到指定学习语境",
    statusCode: 404,
  });
}
