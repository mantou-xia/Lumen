import type {
  DocumentDetail,
  DocumentSummary,
  ImportOperation,
  ImportOperationKind,
  ImportOperationStatus,
  ReadingScene,
} from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

import type {
  DraftDocumentInput,
  DraftRevisionInput,
  LibraryRepositoryPort,
  RecoverableImport,
} from "../application/ports.js";

interface DocumentRow {
  document_id: string;
  active_revision_id: string;
  format_id: string;
  title: string;
  scene_id: ReadingScene;
  original_filename: string;
  byte_size: number;
  status: "ready" | "archived" | "unavailable";
  source_resource_id?: string;
  content_hash?: string;
  created_at: string;
  updated_at: string;
}

interface ImportOperationRow {
  operation_id: string;
  import_kind: ImportOperationKind;
  status: ImportOperationStatus;
  original_filename: string;
  staging_key: string | null;
  document_id: string | null;
  revision_id: string | null;
  resource_id: string | null;
  storage_key: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (row === undefined) {
    throw new Error(message);
  }
  return row;
}

function mapDocumentSummary(row: DocumentRow): DocumentSummary {
  return {
    documentId: row.document_id,
    activeRevisionId: row.active_revision_id,
    formatId: row.format_id,
    title: row.title,
    sceneId: row.scene_id,
    originalFilename: row.original_filename,
    byteSize: row.byte_size,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapImportOperation(row: ImportOperationRow): ImportOperation {
  return {
    operationId: row.operation_id,
    kind: row.import_kind,
    status: row.status,
    originalFilename: row.original_filename,
    documentId: row.document_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

const documentSelect = `
  SELECT
    d.id AS document_id,
    d.active_revision_id,
    d.format_id,
    d.title,
    d.scene_id,
    r.original_filename,
    r.byte_size,
    d.status,
    dr.source_resource_id,
    dr.content_hash,
    d.created_at,
    d.updated_at
  FROM documents d
  JOIN document_revisions dr ON dr.id = d.active_revision_id
  JOIN document_resources r ON r.id = dr.source_resource_id
`;

const importOperationSelect = `
  SELECT
    io.id AS operation_id,
    io.import_kind,
    io.status,
    io.original_filename,
    io.staging_key,
    io.document_id,
    io.revision_id,
    io.resource_id,
    r.storage_key,
    io.error_code,
    io.error_message,
    io.created_at,
    io.updated_at,
    io.completed_at
  FROM import_operations io
  LEFT JOIN document_resources r ON r.id = io.resource_id
`;

export class LibraryRepository implements LibraryRepositoryPort {
  constructor(private readonly connection: DatabaseSync) {}

  createImportOperation(input: {
    operationId: string;
    kind: ImportOperationKind;
    originalFilename: string;
    stagingKey: string;
    documentId: string | null;
    now: string;
  }): void {
    this.connection
      .prepare(`
        INSERT INTO import_operations (
          id, import_kind, status, original_filename, staging_key,
          document_id, created_at, updated_at
        ) VALUES (?, ?, 'requested', ?, ?, ?, ?, ?)
      `)
      .run(
        input.operationId,
        input.kind,
        input.originalFilename,
        input.stagingKey,
        input.documentId,
        input.now,
        input.now,
      );
  }

  updateImportStatus(operationId: string, status: ImportOperationStatus, now: string): void {
    this.connection
      .prepare("UPDATE import_operations SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, now, operationId);
  }

  registerDraftDocument(input: DraftDocumentInput): void {
    this.connection
      .prepare(`
        INSERT INTO documents (
          id, format_id, title, scene_id, active_revision_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, 'unavailable', ?, ?)
      `)
      .run(
        input.documentId,
        input.artifact.descriptor.formatId,
        input.title,
        input.sceneId ?? "english_reading",
        input.now,
        input.now,
      );

    this.registerDraftRevision(input);
  }

  registerDraftRevision(input: DraftRevisionInput): void {
    this.connection
      .prepare(`
        INSERT INTO document_revisions (
          id, document_id, source_resource_id, content_hash, status,
          adapter_version, semantic_projection_version, render_projection_version,
          source_mapping_version, capabilities_snapshot, created_at
        ) VALUES (?, ?, NULL, ?, 'importing', ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.revisionId,
        input.documentId,
        input.contentHash,
        input.artifact.descriptor.adapterVersion,
        input.artifact.descriptor.semanticProjectionVersion,
        input.artifact.descriptor.renderProjectionVersion,
        input.artifact.descriptor.sourceMappingVersion,
        JSON.stringify({
          schemaVersion: 1,
          type: "document.capabilities",
          payload: input.artifact.capabilities,
        }),
        input.now,
      );

    this.connection
      .prepare(`
        INSERT INTO document_resources (
          id, document_id, revision_id, role, media_type, original_filename,
          storage_key, content_hash, byte_size, state, created_at
        ) VALUES (?, ?, ?, 'source', ?, ?, ?, ?, ?, 'staging', ?)
      `)
      .run(
        input.resourceId,
        input.documentId,
        input.revisionId,
        input.sourceMediaType,
        input.originalFilename,
        input.storageKey,
        input.contentHash,
        input.byteSize,
        input.now,
      );

    this.connection
      .prepare("UPDATE document_revisions SET source_resource_id = ? WHERE id = ?")
      .run(input.resourceId, input.revisionId);

    this.connection
      .prepare(`
        INSERT INTO document_projections (revision_id, render_html, created_at)
        VALUES (?, ?, ?)
      `)
      .run(input.revisionId, input.artifact.renderHtml, input.now);

    const insertImage = this.connection.prepare(`
      INSERT INTO markdown_images (
        id, document_id, revision_id, source_url, alt_text, media_type,
        original_filename, storage_key, content_hash, byte_size, state, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const image of input.managedImages) {
      insertImage.run(
        image.resourceId,
        input.documentId,
        input.revisionId,
        image.sourceUrl,
        image.altText,
        image.mediaType,
        image.originalFilename,
        image.storageKey,
        image.contentHash,
        image.byteSize,
        image.state,
        input.now,
      );
    }

    const insertBlock = this.connection.prepare(`
      INSERT INTO semantic_blocks (
        id, revision_id, block_type, block_order, text,
        source_start_offset, source_end_offset
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const block of input.artifact.blocks) {
      insertBlock.run(
        block.blockId,
        input.revisionId,
        block.blockType,
        block.order,
        block.text,
        block.sourceRange.startOffset,
        block.sourceRange.endOffset,
      );
    }

    const insertSourceMapping = this.connection.prepare(`
      INSERT INTO source_mappings (
        id, revision_id, block_id, mapping_kind,
        semantic_start_offset, semantic_end_offset,
        source_start_offset, source_end_offset, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const mapping of input.artifact.sourceMappings) {
      insertSourceMapping.run(
        mapping.mappingId,
        input.revisionId,
        mapping.blockId,
        mapping.mappingKind,
        mapping.semanticStartOffset,
        mapping.semanticEndOffset,
        mapping.sourceStartOffset,
        mapping.sourceEndOffset,
        input.now,
      );
    }

    const insertOutline = this.connection.prepare(`
      INSERT INTO document_outlines (
        id, revision_id, block_id, depth, label, outline_order
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const entry of input.artifact.outline) {
      insertOutline.run(
        entry.outlineId,
        input.revisionId,
        entry.blockId,
        entry.depth,
        entry.label,
        entry.order,
      );
    }

    this.connection
      .prepare(`
        UPDATE import_operations
        SET status = 'committing', document_id = ?, revision_id = ?, resource_id = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(input.documentId, input.revisionId, input.resourceId, input.now, input.operationId);
  }

  completeImport(input: {
    operationId: string;
    documentId: string;
    revisionId: string;
    resourceId: string;
    now: string;
  }): void {
    this.connection
      .prepare("UPDATE document_resources SET state = 'committed' WHERE id = ?")
      .run(input.resourceId);
    this.connection
      .prepare("UPDATE markdown_images SET state = 'committed' WHERE revision_id = ? AND state = 'staging'")
      .run(input.revisionId);
    this.connection
      .prepare("UPDATE document_revisions SET status = 'ready' WHERE id = ?")
      .run(input.revisionId);
    this.connection
      .prepare(`
        UPDATE documents
        SET active_revision_id = ?, status = 'ready', updated_at = ?
        WHERE id = ?
      `)
      .run(input.revisionId, input.now, input.documentId);
    this.connection
      .prepare(`
        UPDATE import_operations
        SET status = 'completed', updated_at = ?, completed_at = ?
        WHERE id = ?
      `)
      .run(input.now, input.now, input.operationId);
  }

  failImport(input: {
    operationId: string;
    errorCode: string;
    errorMessage: string;
    status?: "failed" | "interrupted";
    now: string;
  }): void {
    this.connection
      .prepare(`
        UPDATE import_operations
        SET status = ?, error_code = ?, error_message = ?, updated_at = ?, completed_at = ?
        WHERE id = ?
      `)
      .run(
        input.status ?? "failed",
        input.errorCode,
        input.errorMessage,
        input.now,
        input.now,
        input.operationId,
      );
  }

  deleteDraftDocument(documentId: string): void {
    this.connection
      .prepare(`
        DELETE FROM document_outlines
        WHERE revision_id IN (SELECT id FROM document_revisions WHERE document_id = ?)
      `)
      .run(documentId);
    this.connection
      .prepare(`
        DELETE FROM source_mappings
        WHERE revision_id IN (SELECT id FROM document_revisions WHERE document_id = ?)
      `)
      .run(documentId);
    this.connection
      .prepare(`
        DELETE FROM semantic_blocks
        WHERE revision_id IN (SELECT id FROM document_revisions WHERE document_id = ?)
      `)
      .run(documentId);
    this.connection
      .prepare(`
        DELETE FROM document_projections
        WHERE revision_id IN (SELECT id FROM document_revisions WHERE document_id = ?)
      `)
      .run(documentId);
    this.connection.prepare("DELETE FROM document_resources WHERE document_id = ?").run(documentId);
    this.connection.prepare("DELETE FROM document_revisions WHERE document_id = ?").run(documentId);
    this.connection.prepare("DELETE FROM documents WHERE id = ?").run(documentId);
  }

  deleteDraftRevision(revisionId: string): void {
    this.connection.prepare("DELETE FROM document_outlines WHERE revision_id = ?").run(revisionId);
    this.connection.prepare("DELETE FROM source_mappings WHERE revision_id = ?").run(revisionId);
    this.connection.prepare("DELETE FROM semantic_blocks WHERE revision_id = ?").run(revisionId);
    this.connection.prepare("DELETE FROM document_projections WHERE revision_id = ?").run(revisionId);
    this.connection.prepare("DELETE FROM document_resources WHERE revision_id = ?").run(revisionId);
    this.connection.prepare("DELETE FROM document_revisions WHERE id = ?").run(revisionId);
  }

  listDocumentStorageKeys(documentIds: readonly string[]): string[] {
    if (documentIds.length === 0) return [];
    const placeholders = documentIds.map(() => "?").join(", ");
    const rows = this.connection.prepare(`
      SELECT storage_key FROM document_resources WHERE document_id IN (${placeholders})
      UNION ALL
      SELECT storage_key FROM markdown_images WHERE document_id IN (${placeholders})
    `).all(...documentIds, ...documentIds) as unknown as Array<{ storage_key: string }>;
    return rows.map((row) => row.storage_key);
  }

  listDocuments(): DocumentSummary[] {
    const rows = this.connection
      .prepare(`${documentSelect} WHERE d.status = 'ready' ORDER BY d.updated_at DESC`)
      .all() as unknown as DocumentRow[];
    return rows.map(mapDocumentSummary);
  }

  getDocument(documentId: string): DocumentDetail | null {
    const row = this.connection
      .prepare(`${documentSelect} WHERE d.id = ? AND d.status = 'ready'`)
      .get(documentId) as unknown as DocumentRow | undefined;

    if (row === undefined) {
      return null;
    }

    return {
      ...mapDocumentSummary(row),
      sourceResourceId: requireRow(row.source_resource_id, "Document 缺少 Source Resource"),
      contentHash: requireRow(row.content_hash, "Document 缺少内容哈希"),
    };
  }

  getImportOperation(operationId: string): ImportOperation | null {
    const row = this.connection
      .prepare(`${importOperationSelect} WHERE io.id = ?`)
      .get(operationId) as unknown as ImportOperationRow | undefined;
    return row === undefined ? null : mapImportOperation(row);
  }

  listRecoverableImports(): RecoverableImport[] {
    const rows = this.connection
      .prepare(`
        ${importOperationSelect}
        WHERE io.status IN ('requested', 'receiving', 'inspecting', 'committing')
        ORDER BY io.created_at ASC
      `)
      .all() as unknown as ImportOperationRow[];

    return rows.map((row) => ({
      operationId: row.operation_id,
      kind: row.import_kind,
      status: row.status,
      stagingKey: row.staging_key,
      documentId: row.document_id,
      revisionId: row.revision_id,
      resourceId: row.resource_id,
      storageKey: row.storage_key,
    }));
  }
}
