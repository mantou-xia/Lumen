import type { SourceMapping } from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

import type { SourceMappingRepositoryPort } from "../application/ports.js";

interface MappingRow {
  mapping_id: string;
  revision_id: string;
  block_id: string;
  mapping_kind: string;
  semantic_start_offset: number;
  semantic_end_offset: number;
  source_start_offset: number;
  source_end_offset: number;
}

function mapRow(row: MappingRow): SourceMapping {
  return {
    mappingId: row.mapping_id,
    revisionId: row.revision_id,
    blockId: row.block_id,
    mappingKind: row.mapping_kind,
    semanticStartOffset: row.semantic_start_offset,
    semanticEndOffset: row.semantic_end_offset,
    sourceStartOffset: row.source_start_offset,
    sourceEndOffset: row.source_end_offset,
  };
}

const mappingSelect = `
  SELECT id AS mapping_id, revision_id, block_id, mapping_kind,
    semantic_start_offset, semantic_end_offset,
    source_start_offset, source_end_offset
  FROM source_mappings
`;

export class SourceMappingRepository implements SourceMappingRepositoryPort {
  constructor(private readonly connection: DatabaseSync) {}

  findBySemanticPoint(revisionId: string, blockId: string, offset: number): SourceMapping[] {
    return (this.connection.prepare(`
      ${mappingSelect}
      WHERE revision_id = ? AND block_id = ?
        AND semantic_start_offset <= ? AND semantic_end_offset >= ?
      ORDER BY semantic_start_offset, source_start_offset
    `).all(revisionId, blockId, offset, offset) as unknown as MappingRow[]).map(mapRow);
  }

  findBySourceOffset(revisionId: string, sourceOffset: number): SourceMapping[] {
    return (this.connection.prepare(`
      ${mappingSelect}
      WHERE revision_id = ?
        AND source_start_offset <= ? AND source_end_offset >= ?
      ORDER BY source_start_offset, semantic_start_offset
    `).all(revisionId, sourceOffset, sourceOffset) as unknown as MappingRow[]).map(mapRow);
  }
}
