import {
  annotationSchema,
  type Annotation,
  type AnnotationRangeQuery,
  type AnnotationSource,
  type SemanticSelection,
} from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

import type { AnnotationRepositoryPort } from "../application/ports.js";

interface AnnotationRow {
  id: string;
  document_id: string;
  revision_id: string;
  start_block_id: string;
  start_offset: number;
  end_block_id: string;
  end_offset: number;
  selected_text_snapshot: string;
  source_ranges_snapshot: string;
  note: string;
  source_type: AnnotationSource["type"];
  source_id: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export class AnnotationRepository implements AnnotationRepositoryPort {
  constructor(private readonly connection: DatabaseSync) {}

  sourceExists(documentId: string, revisionId: string, source: AnnotationSource): boolean {
    if (source.type === "selection") return true;
    if (source.type === "translation") {
      return this.connection.prepare(
        "SELECT 1 FROM translations WHERE id = ? AND document_id = ? AND revision_id = ?",
      ).get(source.translationId, documentId, revisionId) !== undefined;
    }
    return this.connection.prepare(
      "SELECT 1 FROM learning_contexts WHERE id = ? AND document_id = ? AND revision_id = ?",
    ).get(source.learningContextId, documentId, revisionId) !== undefined;
  }

  create(input: {
    annotationId: string;
    selection: SemanticSelection;
    note: string;
    source: AnnotationSource;
    now: string;
  }): Annotation {
    const sourceId = input.source.type === "translation"
      ? input.source.translationId
      : input.source.type === "learning_context"
        ? input.source.learningContextId
        : null;
    this.connection.prepare(`
      INSERT INTO annotations (
        id, document_id, revision_id, start_block_id, start_offset,
        end_block_id, end_offset, semantic_range_fingerprint,
        selected_text_snapshot, source_ranges_snapshot, note,
        source_type, source_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      input.annotationId,
      input.selection.documentId,
      input.selection.revisionId,
      input.selection.start.blockId,
      input.selection.start.offset,
      input.selection.end.blockId,
      input.selection.end.offset,
      input.selection.fingerprint,
      input.selection.selectedText,
      JSON.stringify(input.selection.sourceRanges),
      input.note,
      input.source.type,
      sourceId,
      input.now,
      input.now,
    );
    return this.get(input.annotationId)!;
  }

  listRanges(documentId: string, input: AnnotationRangeQuery): Annotation[] {
    const placeholders = input.blockIds.map(() => "?").join(", ");
    const rows = this.connection.prepare(`
      WITH visible AS (
        SELECT MIN(block_order) AS first_order, MAX(block_order) AS last_order
        FROM semantic_blocks
        WHERE revision_id = ? AND id IN (${placeholders})
      )
      SELECT a.*
      FROM annotations a
      JOIN semantic_blocks start_block ON start_block.id = a.start_block_id
      JOIN semantic_blocks end_block ON end_block.id = a.end_block_id
      CROSS JOIN visible
      WHERE a.document_id = ? AND a.revision_id = ? AND a.status = 'active'
        AND start_block.block_order <= visible.last_order
        AND end_block.block_order >= visible.first_order
      ORDER BY start_block.block_order, a.start_offset
    `).all(input.revisionId, ...input.blockIds, documentId, input.revisionId) as unknown as AnnotationRow[];
    return rows.map(mapAnnotation);
  }

  get(annotationId: string): Annotation | null {
    const row = this.connection.prepare("SELECT * FROM annotations WHERE id = ?")
      .get(annotationId) as unknown as AnnotationRow | undefined;
    return row === undefined ? null : mapAnnotation(row);
  }

  updateNote(annotationId: string, note: string, now: string): Annotation | null {
    const result = this.connection.prepare(
      "UPDATE annotations SET note = ?, updated_at = ? WHERE id = ?",
    ).run(note, now, annotationId);
    return result.changes === 1 ? this.get(annotationId) : null;
  }

  archive(annotationId: string, now: string): Annotation | null {
    const result = this.connection.prepare(
      "UPDATE annotations SET status = 'archived', updated_at = ? WHERE id = ?",
    ).run(now, annotationId);
    return result.changes === 1 ? this.get(annotationId) : null;
  }
}

function mapAnnotation(row: AnnotationRow): Annotation {
  const source = row.source_type === "translation"
    ? { type: "translation" as const, translationId: row.source_id! }
    : row.source_type === "learning_context"
      ? { type: "learning_context" as const, learningContextId: row.source_id! }
      : { type: "selection" as const };
  return annotationSchema.parse({
    annotationId: row.id,
    documentId: row.document_id,
    revisionId: row.revision_id,
    start: { blockId: row.start_block_id, offset: row.start_offset },
    end: { blockId: row.end_block_id, offset: row.end_offset },
    selectedText: row.selected_text_snapshot,
    sourceRanges: JSON.parse(row.source_ranges_snapshot),
    note: row.note,
    source,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
