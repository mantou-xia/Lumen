import type {
  OutlineEntry,
  ReadingProgress,
  SemanticBlock,
  SemanticBlockType,
  UpdateReadingProgressRequest,
} from "@lumen/api-contract";
import { documentCapabilitiesSchema } from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

import type {
  ReaderProjection,
  ReaderRepositoryPort,
  ReaderRevisionSource,
} from "../application/ports.js";

interface ProjectionRow {
  revision_id: string;
  format_id: string;
  adapter_version: string;
  semantic_projection_version: string;
  render_projection_version: string;
  source_mapping_version: string;
  capabilities_snapshot: string;
  render_html: string;
}

interface BlockRow {
  id: string;
  block_type: SemanticBlockType;
  block_order: number;
  text: string;
  source_start_offset: number;
  source_end_offset: number;
}

interface RevisionSourceRow {
  storage_key: string;
  original_filename: string;
  media_type: string;
}

interface OutlineRow {
  id: string;
  block_id: string;
  depth: number;
  label: string;
  outline_order: number;
}

interface ProgressRow {
  document_id: string;
  revision_id: string;
  block_id: string;
  semantic_offset: number;
  progression: number;
  saved_at: string;
}

export class ReaderRepository implements ReaderRepositoryPort {
  constructor(private readonly connection: DatabaseSync) {}

  revisionBelongsToDocument(documentId: string, revisionId: string): boolean {
    return this.connection.prepare(
      "SELECT 1 FROM document_revisions WHERE id = ? AND document_id = ? AND status = 'ready'",
    ).get(revisionId, documentId) !== undefined;
  }

  getProjection(revisionId: string): ReaderProjection | null {
    const row = this.connection
      .prepare(`
        SELECT
          dr.id AS revision_id,
          d.format_id,
          dr.adapter_version,
          dr.semantic_projection_version,
          dr.render_projection_version,
          dr.source_mapping_version,
          dr.capabilities_snapshot,
          dp.render_html
        FROM document_revisions dr
        JOIN documents d ON d.id = dr.document_id
        JOIN document_projections dp ON dp.revision_id = dr.id
        WHERE dr.id = ? AND dr.status = 'ready'
      `)
      .get(revisionId) as unknown as ProjectionRow | undefined;
    if (row === undefined) return null;
    const capabilities = documentCapabilitiesSchema.parse(
      (JSON.parse(row.capabilities_snapshot) as { payload: unknown }).payload,
    );
    return {
      revisionId: row.revision_id,
      format: {
        formatId: row.format_id,
        adapterVersion: row.adapter_version,
        semanticProjectionVersion: row.semantic_projection_version,
        renderProjectionVersion: row.render_projection_version,
        sourceMappingVersion: row.source_mapping_version,
        supportedCapabilities: capabilities,
      },
      capabilities,
      renderHtml: row.render_html,
    };
  }

  getRevisionSource(revisionId: string): ReaderRevisionSource | null {
    const row = this.connection.prepare(`
      SELECT r.storage_key, r.original_filename, r.media_type
      FROM document_revisions dr
      JOIN document_resources r ON r.id = dr.source_resource_id
      WHERE dr.id = ? AND dr.status = 'ready' AND r.state = 'committed'
    `).get(revisionId) as unknown as RevisionSourceRow | undefined;
    return row === undefined ? null : {
      storageKey: row.storage_key,
      originalFilename: row.original_filename,
      mediaType: row.media_type,
    };
  }

  listBlocks(revisionId: string): SemanticBlock[] {
    const rows = this.connection
      .prepare(`
        SELECT id, block_type, block_order, text, source_start_offset, source_end_offset
        FROM semantic_blocks
        WHERE revision_id = ?
        ORDER BY block_order
      `)
      .all(revisionId) as unknown as BlockRow[];
    return rows.map((row) => ({
      blockId: row.id,
      blockType: row.block_type,
      order: row.block_order,
      text: row.text,
      sourceRange: {
        startOffset: row.source_start_offset,
        endOffset: row.source_end_offset,
      },
    }));
  }

  listOutline(revisionId: string): OutlineEntry[] {
    const rows = this.connection
      .prepare(`
        SELECT id, block_id, depth, label, outline_order
        FROM document_outlines
        WHERE revision_id = ?
        ORDER BY outline_order
      `)
      .all(revisionId) as unknown as OutlineRow[];
    return rows.map((row) => ({
      outlineId: row.id,
      blockId: row.block_id,
      depth: row.depth,
      label: row.label,
      order: row.outline_order,
    }));
  }

  replaceRenderProjection(input: {
    revisionId: string;
    adapterVersion: string;
    renderProjectionVersion: string;
    renderHtml: string;
    now: string;
  }): void {
    this.connection.prepare(`
      UPDATE document_projections SET render_html = ?, created_at = ? WHERE revision_id = ?
    `).run(input.renderHtml, input.now, input.revisionId);
    this.connection.prepare(`
      UPDATE document_revisions SET adapter_version = ?, render_projection_version = ? WHERE id = ?
    `).run(input.adapterVersion, input.renderProjectionVersion, input.revisionId);
  }

  getProgress(documentId: string): ReadingProgress | null {
    const row = this.connection
      .prepare(`
        SELECT document_id, revision_id, block_id, semantic_offset, progression, saved_at
        FROM reading_progress
        WHERE document_id = ?
      `)
      .get(documentId) as unknown as ProgressRow | undefined;
    return row === undefined
      ? null
      : {
          documentId: row.document_id,
          revisionId: row.revision_id,
          blockId: row.block_id,
          offset: row.semantic_offset,
          progression: row.progression,
          savedAt: row.saved_at,
        };
  }

  isValidPosition(documentId: string, input: UpdateReadingProgressRequest): boolean {
    return (
      this.connection
        .prepare(`
          SELECT 1
          FROM documents d
          JOIN semantic_blocks sb ON sb.revision_id = d.active_revision_id
          WHERE d.id = ? AND d.active_revision_id = ? AND sb.id = ?
            AND ? <= length(sb.text)
        `)
        .get(documentId, input.revisionId, input.blockId, input.offset) !== undefined
    );
  }

  saveProgress(
    documentId: string,
    input: UpdateReadingProgressRequest,
    savedAt: string,
  ): ReadingProgress {
    this.connection
      .prepare(`
        INSERT INTO reading_progress (
          document_id, revision_id, block_id, semantic_offset, progression, saved_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(document_id) DO UPDATE SET
          revision_id = excluded.revision_id,
          block_id = excluded.block_id,
          semantic_offset = excluded.semantic_offset,
          progression = excluded.progression,
          saved_at = excluded.saved_at
      `)
      .run(
        documentId,
        input.revisionId,
        input.blockId,
        input.offset,
        input.progression,
        savedAt,
      );
    return {
      documentId,
      revisionId: input.revisionId,
      blockId: input.blockId,
      offset: input.offset,
      progression: input.progression,
      savedAt,
    };
  }
}
