import type { DatabaseSync } from "node:sqlite";

import type {
  MarkdownImageRecord,
  MarkdownImageRepositoryPort,
} from "../application/ports.js";

interface ImageRow {
  id: string;
  document_id: string;
  revision_id: string;
  alt_text: string;
  state: "committed" | "missing";
}

export class MarkdownImageRepository implements MarkdownImageRepositoryPort {
  constructor(private readonly connection: DatabaseSync) {}

  getImage(documentId: string, revisionId: string, resourceId: string): MarkdownImageRecord | null {
    const row = this.connection.prepare(`
      SELECT id, document_id, revision_id, alt_text, state
      FROM markdown_images
      WHERE id = ? AND document_id = ? AND revision_id = ? AND state IN ('committed', 'missing')
    `).get(resourceId, documentId, revisionId) as unknown as ImageRow | undefined;
    return row === undefined ? null : {
      resourceId: row.id,
      documentId: row.document_id,
      revisionId: row.revision_id,
      altText: row.alt_text,
      state: row.state,
    };
  }

  replaceMissingImage(input: {
    documentId: string;
    revisionId: string;
    resourceId: string;
    originalFilename: string;
    mediaType: string;
    storageKey: string;
    contentHash: string;
    byteSize: number;
    replacementHtml: string;
  }): string | null {
    const projection = this.connection.prepare(`
      SELECT dp.render_html
      FROM document_projections dp
      JOIN document_revisions dr ON dr.id = dp.revision_id
      WHERE dp.revision_id = ? AND dr.document_id = ? AND dr.status = 'ready'
    `).get(input.revisionId, input.documentId) as { render_html: string } | undefined;
    if (projection === undefined) return null;
    const marker = `data-missing-image-id="${input.resourceId}"`;
    const markerIndex = projection.render_html.indexOf(marker);
    if (markerIndex < 0) return null;
    const start = projection.render_html.lastIndexOf("<span", markerIndex);
    const end = projection.render_html.indexOf("</span>", markerIndex);
    if (start < 0 || end < 0) return null;
    const renderHtml = `${projection.render_html.slice(0, start)}${input.replacementHtml}${projection.render_html.slice(end + 7)}`;

    const changed = this.connection.prepare(`
      UPDATE markdown_images
      SET original_filename = ?, media_type = ?, storage_key = ?, content_hash = ?, byte_size = ?, state = 'committed'
      WHERE id = ? AND document_id = ? AND revision_id = ? AND state = 'missing'
    `).run(
      input.originalFilename,
      input.mediaType,
      input.storageKey,
      input.contentHash,
      input.byteSize,
      input.resourceId,
      input.documentId,
      input.revisionId,
    );
    if (changed.changes !== 1) return null;
    this.connection.prepare("UPDATE document_projections SET render_html = ? WHERE revision_id = ?")
      .run(renderHtml, input.revisionId);
    return renderHtml;
  }
}
