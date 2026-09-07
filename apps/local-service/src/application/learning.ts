import { randomUUID } from "node:crypto";

import type { LearningItem } from "@lumen/api-contract";

import { LearningRepository } from "../learning/learning-repository.js";
import { normalizeExpression } from "../learning/expression-normalizer.js";
import type { LumenDatabase } from "../infrastructure/database/database.js";
import { ApplicationError } from "./errors.js";

export class LearningApplication {
  private readonly repository: LearningRepository;

  constructor(private readonly database: LumenDatabase) {
    this.repository = new LearningRepository(database.connection);
  }

  saveFromTranslation(translationId: string): LearningItem {
    return this.database.transaction(() => {
      const translation = this.repository.getCompletedTranslation(translationId);
      if (translation === null) {
        throw new ApplicationError({
          code: "TRANSLATION_NOT_FOUND",
          message: "只能收藏已经完成的翻译结果",
          statusCode: 404,
        });
      }
      const normalizedForm = normalizeExpression(translation.selected_text);
      if (normalizedForm.length === 0) {
        throw new ApplicationError({
          code: "LEARNING_ITEM_INVALID",
          message: "表达归一化后为空，无法收藏",
          statusCode: 409,
        });
      }
      const now = new Date().toISOString();
      const expression = this.repository.findUnambiguousActiveExpression(normalizedForm)
        ?? this.repository.createExpression({
          expressionId: randomUUID(),
          canonicalForm: translation.selected_text,
          normalizedForm,
          expressionType: translation.expression_type,
          now,
        });
      this.repository.ensureObservedVariant({
        variantId: randomUUID(),
        expressionId: expression.id,
        surfacePattern: translation.selected_text,
        normalizedPattern: normalizedForm,
        now,
      });
      const existing = this.repository.findContext(
        expression.id,
        translation.revision_id,
        translation.selection_fingerprint,
      );
      if (existing === null) {
        this.repository.createContext({
          learningContextId: randomUUID(),
          expressionId: expression.id,
          translation,
          now,
        });
      }
      const item = this.repository.getItem(expression.id);
      if (item === null) throw new Error("收藏完成后无法读取 Learning Item");
      return item;
    });
  }

  listItems(): LearningItem[] {
    return this.repository.listItems();
  }
}
