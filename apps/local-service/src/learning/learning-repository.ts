import type { ExpressionType, LearningContext, LearningItem } from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

interface TranslationLearningRow {
  translation_id: string;
  operation_id: string;
  document_id: string;
  revision_id: string;
  start_block_id: string;
  start_offset: number;
  end_block_id: string;
  end_offset: number;
  selected_text: string;
  selection_fingerprint: string;
  surrounding_context: string;
  contextual_translation: string;
  contextual_meaning: string;
  expression_type: ExpressionType;
  explanation: string;
  uncertainty: string;
}

interface ExpressionRow {
  id: string;
  canonical_form: string;
  normalized_form: string;
  expression_type: ExpressionType;
  status: "active" | "familiar" | "archived";
  created_at: string;
  updated_at: string;
}

interface ContextRow {
  id: string;
  expression_id: string;
  document_id: string;
  revision_id: string;
  start_block_id: string;
  start_offset: number;
  end_block_id: string;
  end_offset: number;
  surface_form: string;
  surrounding_context_snapshot: string;
  translation_snapshot: string;
  translation_operation_id: string;
  created_at: string;
}

export class LearningRepository {
  constructor(private readonly connection: DatabaseSync) {}

  getCompletedTranslation(translationId: string): TranslationLearningRow | null {
    const row = this.connection.prepare(`
      SELECT
        t.id AS translation_id, t.operation_id, t.document_id, t.revision_id,
        t.start_block_id, t.start_offset, t.end_block_id, t.end_offset,
        t.selected_text, t.selection_fingerprint, t.surrounding_context,
        t.contextual_translation, t.contextual_meaning, t.expression_type,
        t.explanation, t.uncertainty
      FROM translations t
      JOIN operations o ON o.id = t.operation_id
      WHERE t.id = ? AND o.status = 'completed'
    `).get(translationId) as unknown as TranslationLearningRow | undefined;
    return row ?? null;
  }

  findUnambiguousActiveExpression(normalizedForm: string): ExpressionRow | null {
    const rows = this.connection.prepare(`
      SELECT id, canonical_form, normalized_form, expression_type, status, created_at, updated_at
      FROM expressions WHERE normalized_form = ? AND status = 'active' ORDER BY created_at
      LIMIT 2
    `).all(normalizedForm) as unknown as ExpressionRow[];
    return rows.length === 1 ? rows[0]! : null;
  }

  createExpression(input: {
    expressionId: string;
    canonicalForm: string;
    normalizedForm: string;
    expressionType: ExpressionType;
    now: string;
  }): ExpressionRow {
    this.connection.prepare(`
      INSERT INTO expressions (
        id, canonical_form, normalized_form, expression_type, language, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'en', 'active', ?, ?)
    `).run(
      input.expressionId,
      input.canonicalForm,
      input.normalizedForm,
      input.expressionType,
      input.now,
      input.now,
    );
    return {
      id: input.expressionId,
      canonical_form: input.canonicalForm,
      normalized_form: input.normalizedForm,
      expression_type: input.expressionType,
      status: "active",
      created_at: input.now,
      updated_at: input.now,
    };
  }

  ensureObservedVariant(input: {
    variantId: string;
    expressionId: string;
    surfacePattern: string;
    normalizedPattern: string;
    now: string;
  }): void {
    this.connection.prepare(`
      INSERT INTO expression_variants (
        id, expression_id, surface_pattern, normalized_pattern, variant_type, source, created_at
      ) VALUES (?, ?, ?, ?, 'observed', 'learning_context', ?)
      ON CONFLICT(expression_id, normalized_pattern) DO NOTHING
    `).run(
      input.variantId,
      input.expressionId,
      input.surfacePattern,
      input.normalizedPattern,
      input.now,
    );
  }

  findContext(expressionId: string, revisionId: string, fingerprint: string): LearningContext | null {
    const row = this.connection.prepare(`
      SELECT id, expression_id, document_id, revision_id, start_block_id, start_offset,
        end_block_id, end_offset, surface_form, surrounding_context_snapshot,
        translation_snapshot, translation_operation_id, created_at
      FROM learning_contexts
      WHERE expression_id = ? AND revision_id = ? AND semantic_range_fingerprint = ?
    `).get(expressionId, revisionId, fingerprint) as unknown as ContextRow | undefined;
    return row === undefined ? null : mapContext(row);
  }

  createContext(input: {
    learningContextId: string;
    expressionId: string;
    translation: TranslationLearningRow;
    now: string;
  }): LearningContext {
    const translationSnapshot = JSON.stringify({
      schemaVersion: 1,
      type: "translation.result",
      payload: {
        contextualTranslation: input.translation.contextual_translation,
        contextualMeaning: input.translation.contextual_meaning,
        expressionType: input.translation.expression_type,
        explanation: input.translation.explanation,
        uncertainty: input.translation.uncertainty,
      },
    });
    this.connection.prepare(`
      INSERT INTO learning_contexts (
        id, expression_id, translation_id, document_id, revision_id,
        start_block_id, start_offset, end_block_id, end_offset,
        semantic_range_fingerprint, surface_form, surrounding_context_snapshot,
        translation_snapshot, translation_operation_id, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
      input.learningContextId,
      input.expressionId,
      input.translation.translation_id,
      input.translation.document_id,
      input.translation.revision_id,
      input.translation.start_block_id,
      input.translation.start_offset,
      input.translation.end_block_id,
      input.translation.end_offset,
      input.translation.selection_fingerprint,
      input.translation.selected_text,
      input.translation.surrounding_context,
      translationSnapshot,
      input.translation.operation_id,
      input.now,
    );
    return {
      learningContextId: input.learningContextId,
      expressionId: input.expressionId,
      documentId: input.translation.document_id,
      revisionId: input.translation.revision_id,
      startBlockId: input.translation.start_block_id,
      startOffset: input.translation.start_offset,
      endBlockId: input.translation.end_block_id,
      endOffset: input.translation.end_offset,
      surfaceForm: input.translation.selected_text,
      surroundingContext: input.translation.surrounding_context,
      contextualTranslation: input.translation.contextual_translation,
      contextualMeaning: input.translation.contextual_meaning,
      translationOperationId: input.translation.operation_id,
      createdAt: input.now,
    };
  }

  listItems(): LearningItem[] {
    const expressions = this.connection.prepare(`
      SELECT id, canonical_form, normalized_form, expression_type, status, created_at, updated_at
      FROM expressions WHERE status != 'archived' ORDER BY updated_at DESC
    `).all() as unknown as ExpressionRow[];
    const contexts = this.connection.prepare(`
      SELECT id, expression_id, document_id, revision_id, start_block_id, start_offset,
        end_block_id, end_offset, surface_form, surrounding_context_snapshot,
        translation_snapshot, translation_operation_id, created_at
      FROM learning_contexts WHERE status = 'active' ORDER BY created_at DESC
    `).all() as unknown as ContextRow[];
    return expressions.map((expression) => ({
      expressionId: expression.id,
      canonicalForm: expression.canonical_form,
      normalizedForm: expression.normalized_form,
      expressionType: expression.expression_type,
      status: expression.status,
      contexts: contexts.filter((context) => context.expression_id === expression.id).map(mapContext),
      createdAt: expression.created_at,
      updatedAt: expression.updated_at,
    })).filter((item) => item.contexts.length > 0);
  }

  getItem(expressionId: string): LearningItem | null {
    return this.listItems().find((item) => item.expressionId === expressionId) ?? null;
  }
}

function mapContext(row: ContextRow): LearningContext {
  const snapshot = JSON.parse(row.translation_snapshot) as {
    payload: { contextualTranslation: string; contextualMeaning: string };
  };
  return {
    learningContextId: row.id,
    expressionId: row.expression_id,
    documentId: row.document_id,
    revisionId: row.revision_id,
    startBlockId: row.start_block_id,
    startOffset: row.start_offset,
    endBlockId: row.end_block_id,
    endOffset: row.end_offset,
    surfaceForm: row.surface_form,
    surroundingContext: row.surrounding_context_snapshot,
    contextualTranslation: snapshot.payload.contextualTranslation,
    contextualMeaning: snapshot.payload.contextualMeaning,
    translationOperationId: row.translation_operation_id,
    createdAt: row.created_at,
  };
}
