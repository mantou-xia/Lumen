import type { TranslationResult } from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

export class TranslationRepository {
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
}
