import type { DatabaseSync } from "node:sqlite";

import type { ResourceRecord, ResourceRepositoryPort } from "../application/ports.js";

interface ResourceRow {
  resource_id: string;
  media_type: string;
  original_filename: string;
  storage_key: string;
  byte_size: number;
  state: "committed" | "missing";
}

export class ResourceRepository implements ResourceRepositoryPort {
  constructor(private readonly connection: DatabaseSync) {}

  getResource(resourceId: string): ResourceRecord | null {
    const row = this.connection.prepare(`
      SELECT resource_id, media_type, original_filename, storage_key, byte_size, state
      FROM (
        SELECT id AS resource_id, media_type, original_filename, storage_key, byte_size, state
        FROM document_resources
        UNION ALL
        SELECT id AS resource_id, media_type, original_filename, storage_key, byte_size, state
        FROM markdown_images
      )
      WHERE resource_id = ? AND state IN ('committed', 'missing')
    `).get(resourceId) as unknown as ResourceRow | undefined;
    return row === undefined ? null : {
      resourceId: row.resource_id,
      mediaType: row.media_type,
      originalFilename: row.original_filename,
      storageKey: row.storage_key,
      byteSize: row.byte_size,
      state: row.state,
    };
  }
}
