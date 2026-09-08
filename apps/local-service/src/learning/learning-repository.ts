import {
  lexicalLocalizationSchema,
  lexicalProfileSchema,
  type ExpressionType,
  type LearningContext,
  type LearningContextDetail,
  type LearningContextSort,
  type LearningExpressionDetail,
  type LearningExpressionSummary,
  type LearningItem,
  type LearningListQuery,
  type LexicalLocalization,
  type LexicalProfile,
} from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

import type {
  ExpressionRecord,
  LearningQueryResult,
  LearningRepositoryPort,
  LearningTranslationRecord,
} from "../application/ports.js";
import { buildLexicalLookupCandidates } from "../lexical/lookup-candidates.js";

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
  user_note: string | null;
  created_at: string;
  updated_at: string;
}

interface ExpressionSummaryRow extends ExpressionRow {
  context_count: number;
}

interface ContextRow {
  id: string;
  expression_id: string;
  translation_id: string;
  document_id: string;
  document_title: string;
  revision_id: string;
  start_block_id: string;
  start_offset: number;
  end_block_id: string;
  end_offset: number;
  surface_form: string;
  surrounding_context_snapshot: string;
  translation_snapshot: string;
  translation_operation_id: string;
  status: "active" | "archived";
  user_note: string | null;
  created_at: string;
  updated_at: string | null;
  block_order: number;
  heading_text: string | null;
}

interface LegacyContextRow {
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

interface LexicalRow {
  normalized_lemma: string;
  profile_snapshot: string;
  localization_snapshot: string | null;
}

interface TranslationSnapshot {
  payload: {
    contextualTranslation: string;
    contextualMeaning: string;
    explanation?: string;
    uncertainty?: string;
  };
}

export class LearningRepository implements LearningRepositoryPort {
  constructor(private readonly connection: DatabaseSync) {}

  getCompletedTranslation(translationId: string): LearningTranslationRecord | null {
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
    return row === undefined ? null : {
      translationId: row.translation_id,
      operationId: row.operation_id,
      documentId: row.document_id,
      revisionId: row.revision_id,
      startBlockId: row.start_block_id,
      startOffset: row.start_offset,
      endBlockId: row.end_block_id,
      endOffset: row.end_offset,
      selectedText: row.selected_text,
      selectionFingerprint: row.selection_fingerprint,
      surroundingContext: row.surrounding_context,
      contextualTranslation: row.contextual_translation,
      contextualMeaning: row.contextual_meaning,
      expressionType: row.expression_type,
      explanation: row.explanation,
      uncertainty: row.uncertainty,
    };
  }

  findUnambiguousExpression(normalizedForm: string): ExpressionRecord | null {
    const rows = this.connection.prepare(`
      SELECT id, canonical_form, normalized_form, expression_type, status,
        user_note, created_at, updated_at
      FROM expressions WHERE normalized_form = ? ORDER BY created_at
      LIMIT 2
    `).all(normalizedForm) as unknown as ExpressionRow[];
    return rows.length === 1 ? mapExpression(rows[0]!) : null;
  }

  createExpression(input: {
    expressionId: string;
    canonicalForm: string;
    normalizedForm: string;
    expressionType: ExpressionType;
    now: string;
  }): ExpressionRecord {
    this.connection.prepare(`
      INSERT INTO expressions (
        id, canonical_form, normalized_form, expression_type, language,
        status, user_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'en', 'active', '', ?, ?)
    `).run(input.expressionId, input.canonicalForm, input.normalizedForm, input.expressionType, input.now, input.now);
    return {
      expressionId: input.expressionId,
      canonicalForm: input.canonicalForm,
      normalizedForm: input.normalizedForm,
      expressionType: input.expressionType,
      status: "active",
      userNote: "",
      createdAt: input.now,
      updatedAt: input.now,
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
    `).run(input.variantId, input.expressionId, input.surfacePattern, input.normalizedPattern, input.now);
  }

  findContext(expressionId: string, revisionId: string, fingerprint: string): LearningContext | null {
    const row = this.connection.prepare(`
      SELECT id, expression_id, document_id, revision_id, start_block_id, start_offset,
        end_block_id, end_offset, surface_form, surrounding_context_snapshot,
        translation_snapshot, translation_operation_id, created_at
      FROM learning_contexts
      WHERE expression_id = ? AND revision_id = ? AND semantic_range_fingerprint = ?
    `).get(expressionId, revisionId, fingerprint) as unknown as LegacyContextRow | undefined;
    return row === undefined ? null : mapLegacyContext(row);
  }

  restoreContext(expressionId: string, revisionId: string, fingerprint: string, now: string): void {
    this.connection.prepare(`
      UPDATE learning_contexts SET status = 'active', updated_at = ?
      WHERE expression_id = ? AND revision_id = ? AND semantic_range_fingerprint = ?
    `).run(now, expressionId, revisionId, fingerprint);
    this.connection.prepare("UPDATE expressions SET updated_at = ? WHERE id = ?")
      .run(now, expressionId);
  }

  createContext(input: {
    learningContextId: string;
    expressionId: string;
    translation: LearningTranslationRecord;
    now: string;
  }): LearningContext {
    const translationSnapshot = JSON.stringify({
      schemaVersion: 1,
      type: "translation.result",
      payload: {
        contextualTranslation: input.translation.contextualTranslation,
        contextualMeaning: input.translation.contextualMeaning,
        expressionType: input.translation.expressionType,
        explanation: input.translation.explanation,
        uncertainty: input.translation.uncertainty,
      },
    });
    this.connection.prepare(`
      INSERT INTO learning_contexts (
        id, expression_id, translation_id, document_id, revision_id,
        start_block_id, start_offset, end_block_id, end_offset,
        semantic_range_fingerprint, surface_form, surrounding_context_snapshot,
        translation_snapshot, translation_operation_id, status, user_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', '', ?, ?)
    `).run(
      input.learningContextId, input.expressionId, input.translation.translationId,
      input.translation.documentId, input.translation.revisionId,
      input.translation.startBlockId, input.translation.startOffset,
      input.translation.endBlockId, input.translation.endOffset,
      input.translation.selectionFingerprint, input.translation.selectedText,
      input.translation.surroundingContext, translationSnapshot,
      input.translation.operationId, input.now, input.now,
    );
    this.connection.prepare("UPDATE expressions SET updated_at = ? WHERE id = ?")
      .run(input.now, input.expressionId);
    return {
      learningContextId: input.learningContextId,
      expressionId: input.expressionId,
      documentId: input.translation.documentId,
      revisionId: input.translation.revisionId,
      startBlockId: input.translation.startBlockId,
      startOffset: input.translation.startOffset,
      endBlockId: input.translation.endBlockId,
      endOffset: input.translation.endOffset,
      surfaceForm: input.translation.selectedText,
      surroundingContext: input.translation.surroundingContext,
      contextualTranslation: input.translation.contextualTranslation,
      contextualMeaning: input.translation.contextualMeaning,
      translationOperationId: input.translation.operationId,
      createdAt: input.now,
    };
  }

  listItems(): LearningItem[] {
    const expressions = this.connection.prepare(`
      SELECT id FROM expressions WHERE status != 'archived' ORDER BY updated_at DESC
    `).all() as unknown as Array<{ id: string }>;
    return expressions.flatMap(({ id }) => {
      const item = this.getItem(id);
      return item === null ? [] : [item];
    });
  }

  getItem(expressionId: string): LearningItem | null {
    const expression = this.connection.prepare(`
      SELECT id, canonical_form, normalized_form, expression_type, status,
        user_note, created_at, updated_at
      FROM expressions WHERE id = ?
    `).get(expressionId) as unknown as ExpressionRow | undefined;
    if (expression === undefined) return null;
    const contexts = this.connection.prepare(`
      SELECT id, expression_id, document_id, revision_id, start_block_id, start_offset,
        end_block_id, end_offset, surface_form, surrounding_context_snapshot,
        translation_snapshot, translation_operation_id, created_at
      FROM learning_contexts
      WHERE expression_id = ? AND status = 'active'
      ORDER BY created_at DESC
    `).all(expressionId) as unknown as LegacyContextRow[];
    if (contexts.length === 0) return null;
    return {
      expressionId: expression.id,
      canonicalForm: expression.canonical_form,
      normalizedForm: expression.normalized_form,
      expressionType: expression.expression_type,
      status: expression.status,
      contexts: contexts.map(mapLegacyContext),
      createdAt: expression.created_at,
      updatedAt: expression.updated_at,
    };
  }

  queryItems(input: LearningListQuery & { offset: number }): LearningQueryResult {
    const { sql: whereSql, values } = buildExpressionWhere(input);
    const countRow = this.connection.prepare(`
      SELECT COUNT(*) AS count FROM expressions e ${whereSql}
    `).get(...values) as unknown as { count: number };
    const contextCountRow = this.connection.prepare(`
      SELECT COUNT(*) AS count
      FROM learning_contexts counted_context
      JOIN expressions e ON e.id = counted_context.expression_id
      ${whereSql} AND counted_context.status = 'active'
    `).get(...values) as unknown as { count: number };
    const orderSql = input.sort === "canonical_asc"
      ? "e.canonical_form COLLATE NOCASE ASC, e.id ASC"
      : input.sort === "context_count_desc"
        ? "context_count DESC, e.updated_at DESC, e.id ASC"
        : "e.updated_at DESC, e.id ASC";
    const rows = this.connection.prepare(`
      SELECT e.id, e.canonical_form, e.normalized_form, e.expression_type,
        e.status, e.user_note, e.created_at, e.updated_at,
        (
          SELECT COUNT(*) FROM learning_contexts active_context
          WHERE active_context.expression_id = e.id AND active_context.status = 'active'
        ) AS context_count
      FROM expressions e
      ${whereSql}
      ORDER BY ${orderSql}
      LIMIT ? OFFSET ?
    `).all(...values, input.limit + 1, input.offset) as unknown as ExpressionSummaryRow[];
    return {
      items: rows.slice(0, input.limit).map((row) => this.mapSummary(row)),
      totalExpressions: countRow.count,
      totalContexts: contextCountRow.count,
      hasMore: rows.length > input.limit,
    };
  }

  getDetails(expressionId: string, contextSort: LearningContextSort): LearningExpressionDetail | null {
    const expression = this.connection.prepare(`
      SELECT id, canonical_form, normalized_form, expression_type, status,
        user_note, created_at, updated_at
      FROM expressions WHERE id = ?
    `).get(expressionId) as unknown as ExpressionRow | undefined;
    if (expression === undefined) return null;
    const contexts = this.connection.prepare(`${contextDetailSelect}
      WHERE lc.expression_id = ?
      ORDER BY lc.created_at ${contextSort === "oldest" ? "ASC" : "DESC"}, lc.id ASC
    `).all(expressionId) as unknown as ContextRow[];
    const lexical = this.findLexicalKnowledge(expression.canonical_form);
    return {
      expressionId: expression.id,
      canonicalForm: expression.canonical_form,
      normalizedForm: expression.normalized_form,
      expressionType: expression.expression_type,
      status: expression.status,
      userNote: expression.user_note ?? "",
      lexicalProfile: lexical.profile,
      lexicalLocalization: lexical.localization,
      contexts: contexts.map(mapContextDetail),
      createdAt: expression.created_at,
      updatedAt: expression.updated_at,
    };
  }

  updateExpressionStatus(input: {
    historyId: string;
    expressionId: string;
    status: ExpressionRecord["status"];
    now: string;
  }): boolean {
    const current = this.connection.prepare("SELECT status FROM expressions WHERE id = ?")
      .get(input.expressionId) as unknown as { status: ExpressionRecord["status"] } | undefined;
    if (current === undefined) return false;
    if (current.status === input.status) return true;
    this.connection.prepare("UPDATE expressions SET status = ?, updated_at = ? WHERE id = ?")
      .run(input.status, input.now, input.expressionId);
    this.connection.prepare(`
      INSERT INTO expression_status_history (
        id, expression_id, previous_status, next_status, changed_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(input.historyId, input.expressionId, current.status, input.status, input.now);
    return true;
  }

  updateExpressionNote(expressionId: string, note: string, now: string): boolean {
    return this.connection.prepare(
      "UPDATE expressions SET user_note = ?, updated_at = ? WHERE id = ?",
    ).run(note, now, expressionId).changes === 1;
  }

  updateContextNote(expressionId: string, contextId: string, note: string, now: string): boolean {
    return this.connection.prepare(`
      UPDATE learning_contexts SET user_note = ?, updated_at = ?
      WHERE id = ? AND expression_id = ?
    `).run(note, now, contextId, expressionId).changes === 1;
  }

  archiveContext(expressionId: string, contextId: string, now: string): boolean {
    const result = this.connection.prepare(`
      UPDATE learning_contexts SET status = 'archived', updated_at = ?
      WHERE id = ? AND expression_id = ?
    `).run(now, contextId, expressionId);
    if (result.changes !== 1) return false;
    this.connection.prepare("UPDATE expressions SET updated_at = ? WHERE id = ?")
      .run(now, expressionId);
    return true;
  }

  private mapSummary(row: ExpressionSummaryRow): LearningExpressionSummary {
    const latest = this.connection.prepare(`${contextDetailSelect}
      WHERE lc.expression_id = ? AND lc.status = 'active'
      ORDER BY lc.created_at DESC, lc.id ASC LIMIT 1
    `).get(row.id) as unknown as ContextRow | undefined;
    const lexical = this.findLexicalKnowledge(row.canonical_form);
    return {
      expressionId: row.id,
      canonicalForm: row.canonical_form,
      normalizedForm: row.normalized_form,
      expressionType: row.expression_type,
      status: row.status,
      userNote: row.user_note ?? "",
      stableMeaning: lexical.localization?.senses[0]?.chineseGloss
        ?? lexical.profile?.partsOfSpeech[0]?.senses[0]?.gloss
        ?? null,
      pronunciation: lexical.profile?.pronunciations.find((item) => item.system === "ipa")?.value
        ?? lexical.profile?.pronunciations[0]?.value
        ?? null,
      audioUrl: null,
      partsOfSpeech: lexical.profile === null
        ? []
        : [...new Set(lexical.profile.partsOfSpeech.map((item) => item.partOfSpeech))],
      latestContext: latest === undefined ? null : mapContextSummary(latest),
      contextCount: row.context_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private findLexicalKnowledge(value: string): {
    profile: LexicalProfile | null;
    localization: LexicalLocalization | null;
  } {
    const candidates = buildLexicalLookupCandidates(value);
    if (candidates.length === 0) return { profile: null, localization: null };
    const placeholders = candidates.map(() => "?").join(", ");
    const rows = this.connection.prepare(`
      SELECT e.normalized_lemma, p.profile_snapshot, l.localization_snapshot
      FROM lexical_entries e
      JOIN lexical_profiles p ON p.entry_id = e.id
      LEFT JOIN lexical_localizations l
        ON l.entry_id = e.id AND l.source_revision_id = e.source_revision_id
      WHERE e.source = 'en.wiktionary' AND e.language = 'en'
        AND e.normalized_lemma IN (${placeholders})
    `).all(...candidates) as unknown as LexicalRow[];
    const byLemma = new Map(rows.map((row) => [row.normalized_lemma, row]));
    const matched = candidates.map((candidate) => byLemma.get(candidate)).find(Boolean);
    if (matched === undefined) return { profile: null, localization: null };
    return {
      profile: lexicalProfileSchema.parse(JSON.parse(matched.profile_snapshot)),
      localization: matched.localization_snapshot === null
        ? null
        : lexicalLocalizationSchema.parse(JSON.parse(matched.localization_snapshot)),
    };
  }
}

const contextDetailSelect = `
  SELECT lc.id, lc.expression_id, lc.translation_id, lc.document_id,
    d.title AS document_title, lc.revision_id, lc.start_block_id, lc.start_offset,
    lc.end_block_id, lc.end_offset, lc.surface_form,
    lc.surrounding_context_snapshot, lc.translation_snapshot,
    lc.translation_operation_id, lc.status, lc.user_note,
    lc.created_at, lc.updated_at, current_block.block_order,
    (
      SELECT heading.text FROM semantic_blocks heading
      WHERE heading.revision_id = lc.revision_id
        AND heading.block_type = 'heading'
        AND heading.block_order <= current_block.block_order
      ORDER BY heading.block_order DESC LIMIT 1
    ) AS heading_text
  FROM learning_contexts lc
  JOIN documents d ON d.id = lc.document_id
  JOIN semantic_blocks current_block ON current_block.id = lc.start_block_id
`;

function buildExpressionWhere(input: LearningListQuery): { sql: string; values: string[] } {
  const conditions: string[] = [];
  const values: string[] = [];
  if (input.status === undefined) conditions.push("e.status != 'archived'");
  else {
    conditions.push("e.status = ?");
    values.push(input.status);
  }
  if (input.expressionType !== undefined) {
    conditions.push("e.expression_type = ?");
    values.push(input.expressionType);
  }
  if (input.sourceDocumentId !== undefined) {
    conditions.push(`EXISTS (
      SELECT 1 FROM learning_contexts source_context
      WHERE source_context.expression_id = e.id AND source_context.document_id = ?
    )`);
    values.push(input.sourceDocumentId);
  }
  if (input.query.length > 0) {
    const term = `%${escapeLike(input.query)}%`;
    conditions.push(`(
      e.canonical_form LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR e.normalized_form LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR COALESCE(e.user_note, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR EXISTS (
        SELECT 1 FROM expression_variants variant
        WHERE variant.expression_id = e.id AND (
          variant.surface_pattern LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR variant.normalized_pattern LIKE ? ESCAPE '\\' COLLATE NOCASE
        )
      )
      OR EXISTS (
        SELECT 1 FROM learning_contexts searched_context
        WHERE searched_context.expression_id = e.id AND (
          searched_context.surface_form LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR searched_context.surrounding_context_snapshot LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR searched_context.translation_snapshot LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR COALESCE(searched_context.user_note, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
        )
      )
    )`);
    values.push(term, term, term, term, term, term, term, term, term);
  }
  return { sql: `WHERE ${conditions.join(" AND ")}`, values };
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function mapExpression(row: ExpressionRow): ExpressionRecord {
  return {
    expressionId: row.id,
    canonicalForm: row.canonical_form,
    normalizedForm: row.normalized_form,
    expressionType: row.expression_type,
    status: row.status,
    userNote: row.user_note ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLegacyContext(row: LegacyContextRow): LearningContext {
  const snapshot = JSON.parse(row.translation_snapshot) as TranslationSnapshot;
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

function mapContextSummary(row: ContextRow): LearningExpressionSummary["latestContext"] {
  const snapshot = JSON.parse(row.translation_snapshot) as TranslationSnapshot;
  return {
    learningContextId: row.id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    revisionId: row.revision_id,
    surfaceForm: row.surface_form,
    surroundingContext: row.surrounding_context_snapshot,
    contextualTranslation: snapshot.payload.contextualTranslation,
    contextualMeaning: snapshot.payload.contextualMeaning,
    createdAt: row.created_at,
  };
}

function mapContextDetail(row: ContextRow): LearningContextDetail {
  const snapshot = JSON.parse(row.translation_snapshot) as TranslationSnapshot;
  return {
    learningContextId: row.id,
    expressionId: row.expression_id,
    translationId: row.translation_id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    revisionId: row.revision_id,
    locationLabel: row.heading_text ?? `第 ${row.block_order + 1} 个语义块`,
    startBlockId: row.start_block_id,
    startOffset: row.start_offset,
    endBlockId: row.end_block_id,
    endOffset: row.end_offset,
    surfaceForm: row.surface_form,
    surroundingContext: row.surrounding_context_snapshot,
    contextualTranslation: snapshot.payload.contextualTranslation,
    contextualMeaning: snapshot.payload.contextualMeaning,
    explanation: snapshot.payload.explanation ?? "",
    uncertainty: snapshot.payload.uncertainty ?? "",
    translationOperationId: row.translation_operation_id,
    status: row.status,
    userNote: row.user_note ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}
