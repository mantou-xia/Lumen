import type {
  TranslationRangeQuery,
  TranslationRangeSummary,
  TranslationResult,
} from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

import type { TranslationRepositoryPort } from "../application/ports.js";

export class TranslationRepository implements TranslationRepositoryPort {
  constructor(private readonly connection: DatabaseSync) {}

  save(result: TranslationResult): void {
    this.connection.prepare(`
      INSERT INTO translations (
        id, operation_id, document_id, revision_id, selection_id,
        start_block_id, start_offset, end_block_id, end_offset,
        selected_text, selection_fingerprint, surrounding_context,
        contextual_translation, contextual_meaning, expression_type,
        explanation, uncertainty, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      result.translationId,
      result.operationId,
      result.selection.documentId,
      result.selection.revisionId,
      result.selection.selectionId,
      result.selection.start.blockId,
      result.selection.start.offset,
      result.selection.end.blockId,
      result.selection.end.offset,
      result.selection.selectedText,
      result.selection.fingerprint,
      result.surroundingContext,
      result.contextualTranslation,
      result.contextualMeaning,
      result.expressionType,
      result.explanation,
      result.uncertainty,
      result.createdAt,
    );
  }

  getById(translationId: string): TranslationResult | null {
    return this.readResult("t.id = ?", translationId);
  }

  findByFingerprint(revisionId: string, fingerprint: string): TranslationResult | null {
    return this.readResult(
      "t.revision_id = ? AND t.selection_fingerprint = ?",
      revisionId,
      fingerprint,
    );
  }

  listRanges(documentId: string, input: TranslationRangeQuery): TranslationRangeSummary[] {
    const placeholders = input.blockIds.map(() => "?").join(", ");
    const rows = this.connection.prepare(`
      SELECT DISTINCT t.id, t.operation_id, t.revision_id,
        t.start_block_id, t.start_offset, t.end_block_id, t.end_offset,
        t.selected_text, t.selection_fingerprint, t.created_at
      FROM translations t
      JOIN semantic_blocks start_block ON start_block.id = t.start_block_id
      JOIN semantic_blocks end_block ON end_block.id = t.end_block_id
      JOIN semantic_blocks visible_block
        ON visible_block.revision_id = t.revision_id
        AND visible_block.block_order BETWEEN start_block.block_order AND end_block.block_order
      WHERE t.document_id = ? AND t.revision_id = ?
        AND t.rowid = (
          SELECT MAX(latest.rowid) FROM translations latest
          WHERE latest.revision_id = t.revision_id
            AND latest.selection_fingerprint = t.selection_fingerprint
        )
        AND visible_block.id IN (${placeholders})
      ORDER BY t.created_at
    `).all(documentId, input.revisionId, ...input.blockIds) as unknown as TranslationRow[];
    return rows.map((row) => ({
      translationId: row.id,
      operationId: row.operation_id,
      revisionId: row.revision_id,
      start: { blockId: row.start_block_id, offset: row.start_offset },
      end: { blockId: row.end_block_id, offset: row.end_offset },
      selectedText: row.selected_text,
      fingerprint: row.selection_fingerprint,
      createdAt: row.created_at,
    }));
  }

  private readResult(where: string, ...parameters: string[]): TranslationResult | null {
    const row = this.connection.prepare(`
      SELECT t.id, t.operation_id, t.document_id, t.revision_id, t.selection_id,
        t.start_block_id, t.start_offset, t.end_block_id, t.end_offset,
        t.selected_text, t.selection_fingerprint, t.surrounding_context,
        t.contextual_translation, t.contextual_meaning, t.expression_type,
        t.explanation, t.uncertainty, t.created_at,
        start_block.block_order AS start_block_order,
        end_block.block_order AS end_block_order
      FROM translations t
      JOIN semantic_blocks start_block ON start_block.id = t.start_block_id
      JOIN semantic_blocks end_block ON end_block.id = t.end_block_id
      WHERE ${where}
      ORDER BY t.created_at DESC, t.rowid DESC
      LIMIT 1
    `).get(...parameters) as unknown as TranslationRow | undefined;
    if (row === undefined) return null;
    const mappings = this.connection.prepare(`
      SELECT sb.id, sb.text, sm.mapping_kind, sm.source_start_offset, sm.source_end_offset
      FROM semantic_blocks sb
      JOIN source_mappings sm ON sm.revision_id = sb.revision_id AND sm.block_id = sb.id
      WHERE sb.revision_id = ? AND sb.block_order BETWEEN ? AND ?
      ORDER BY sb.block_order
    `).all(
      row.revision_id,
      row.start_block_order,
      row.end_block_order,
    ) as unknown as MappingRow[];
    return {
      translationId: row.id,
      operationId: row.operation_id,
      selection: {
        selectionId: row.selection_id,
        documentId: row.document_id,
        revisionId: row.revision_id,
        start: { blockId: row.start_block_id, offset: row.start_offset },
        end: { blockId: row.end_block_id, offset: row.end_offset },
        selectedText: row.selected_text,
        sourceRanges: mappings.map((mapping) => ({
          blockId: mapping.id,
          semanticStartOffset: mapping.id === row.start_block_id ? row.start_offset : 0,
          semanticEndOffset: mapping.id === row.end_block_id ? row.end_offset : mapping.text.length,
          source: {
            kind: mapping.mapping_kind.replaceAll("_", "-"),
            startOffset: mapping.source_start_offset,
            endOffset: mapping.source_end_offset,
          },
        })),
        fingerprint: row.selection_fingerprint,
      },
      surroundingContext: row.surrounding_context,
      contextualTranslation: row.contextual_translation,
      contextualMeaning: row.contextual_meaning,
      expressionType: row.expression_type,
      explanation: row.explanation,
      uncertainty: row.uncertainty,
      createdAt: row.created_at,
    };
  }
}

interface TranslationRow {
  id: string;
  operation_id: string;
  document_id: string;
  revision_id: string;
  selection_id: string;
  start_block_id: string;
  start_offset: number;
  end_block_id: string;
  end_offset: number;
  selected_text: string;
  selection_fingerprint: string;
  surrounding_context: string;
  contextual_translation: string;
  contextual_meaning: string;
  expression_type: TranslationResult["expressionType"];
  explanation: string;
  uncertainty: string;
  created_at: string;
  start_block_order: number;
  end_block_order: number;
}

interface MappingRow {
  id: string;
  text: string;
  mapping_kind: string;
  source_start_offset: number;
  source_end_offset: number;
}
