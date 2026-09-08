import type { RecallEvaluation, RecallMatch, RecallOccurrence } from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

import type { RecallRepositoryPort } from "../application/ports.js";
import { normalizeExpression } from "./expression-normalizer.js";

interface VariantRow {
  variant_id: string;
  expression_id: string;
  canonical_form: string;
  surface_pattern: string;
  normalized_pattern: string;
}

interface BlockRow { id: string; block_order: number; text: string }
interface OccurrenceRow {
  id: string;
  expression_id: string;
  document_id: string;
  revision_id: string;
  block_id: string;
  start_offset: number;
  end_offset: number;
  surface_form: string;
  current_context_snapshot: string;
  created_at: string;
}

function hasWordBoundaries(text: string, start: number, end: number): boolean {
  const startsAtBoundary = start === 0 || !/[\p{L}\p{N}_]/u.test(text[start - 1]!);
  const endsAtBoundary = end === text.length || !/[\p{L}\p{N}_]/u.test(text[end]!);
  return startsAtBoundary && endsAtBoundary;
}

export class RecallRepository implements RecallRepositoryPort {
  constructor(private readonly connection: DatabaseSync) {}

  findMatches(revisionId: string, blockIds: string[]): RecallMatch[] {
    const placeholders = blockIds.map(() => "?").join(", ");
    const blocks = this.connection.prepare(`
      SELECT id, block_order, text FROM semantic_blocks
      WHERE revision_id = ? AND id IN (${placeholders}) ORDER BY block_order
    `).all(revisionId, ...blockIds) as unknown as BlockRow[];
    const variants = this.connection.prepare(`
      SELECT ev.id AS variant_id, ev.expression_id, e.canonical_form,
        ev.surface_pattern, ev.normalized_pattern
      FROM expression_variants ev
      JOIN expressions e ON e.id = ev.expression_id
      WHERE e.status = 'active'
      ORDER BY length(ev.surface_pattern) DESC
    `).all() as unknown as VariantRow[];
    const matches: RecallMatch[] = [];
    const seen = new Set<string>();

    for (const block of blocks) {
      const normalizedBlock = normalizeExpression(block.text);
      for (const variant of variants) {
        const needle = variant.normalized_pattern;
        let offset = 0;
        while (offset <= normalizedBlock.length - needle.length) {
          const index = normalizedBlock.indexOf(needle, offset);
          if (index < 0) break;
          const end = index + needle.length;
          if (hasWordBoundaries(normalizedBlock, index, end)) {
            const key = `${variant.expression_id}:${block.id}:${index}:${end}`;
            if (!seen.has(key)) {
              seen.add(key);
              const surface = block.text.slice(index, end);
              matches.push({
                expressionId: variant.expression_id,
                canonicalForm: variant.canonical_form,
                matchedVariantId: variant.variant_id,
                blockId: block.id,
                startOffset: index,
                endOffset: end,
                surfaceForm: surface,
                matchType: surface === variant.surface_pattern
                  ? "exact"
                  : normalizeExpression(variant.canonical_form) === needle
                    ? "case_insensitive"
                    : "registered_variant",
              });
            }
          }
          offset = index + Math.max(1, needle.length);
        }
      }
    }
    return matches;
  }

  validateMatch(revisionId: string, match: RecallMatch): { documentId: string; currentContext: string } | null {
    const row = this.connection.prepare(`
      SELECT d.id AS document_id, sb.block_order, sb.text
      FROM documents d
      JOIN semantic_blocks sb ON sb.revision_id = d.active_revision_id
      JOIN expression_variants ev ON ev.id = ? AND ev.expression_id = ?
      WHERE d.active_revision_id = ? AND sb.id = ?
        AND ev.normalized_pattern = ?
    `).get(
      match.matchedVariantId,
      match.expressionId,
      revisionId,
      match.blockId,
      normalizeExpression(match.surfaceForm),
    ) as unknown as { document_id: string; block_order: number; text: string } | undefined;
    if (
      row === undefined ||
      row.text.slice(match.startOffset, match.endOffset) !== match.surfaceForm
    ) return null;
    const nearby = this.connection.prepare(`
      SELECT text FROM semantic_blocks
      WHERE revision_id = ? AND block_order BETWEEN ? AND ? ORDER BY block_order
    `).all(revisionId, Math.max(0, row.block_order - 1), row.block_order + 1) as Array<{ text: string }>;
    return { documentId: row.document_id, currentContext: nearby.map((item) => item.text).join("\n\n") };
  }

  findOrCreateOccurrence(input: {
    occurrenceId: string;
    documentId: string;
    revisionId: string;
    match: RecallMatch;
    currentContext: string;
    now: string;
  }): RecallOccurrence {
    this.connection.prepare(`
      INSERT INTO recall_occurrences (
        id, expression_id, document_id, revision_id, block_id, start_offset,
        end_offset, surface_form, current_context_snapshot, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(expression_id, revision_id, block_id, start_offset, end_offset) DO NOTHING
    `).run(
      input.occurrenceId,
      input.match.expressionId,
      input.documentId,
      input.revisionId,
      input.match.blockId,
      input.match.startOffset,
      input.match.endOffset,
      input.match.surfaceForm,
      input.currentContext,
      input.now,
    );
    const row = this.connection.prepare(`
      SELECT id, expression_id, document_id, revision_id, block_id, start_offset,
        end_offset, surface_form, current_context_snapshot, created_at
      FROM recall_occurrences
      WHERE expression_id = ? AND revision_id = ? AND block_id = ?
        AND start_offset = ? AND end_offset = ?
    `).get(
      input.match.expressionId,
      input.revisionId,
      input.match.blockId,
      input.match.startOffset,
      input.match.endOffset,
    ) as unknown as OccurrenceRow;
    return mapOccurrence(row);
  }

  getOccurrence(occurrenceId: string): (RecallOccurrence & { canonicalForm: string; historicalMeaning: string }) | null {
    const row = this.connection.prepare(`
      SELECT ro.id, ro.expression_id, ro.document_id, ro.revision_id, ro.block_id,
        ro.start_offset, ro.end_offset, ro.surface_form, ro.current_context_snapshot,
        ro.created_at, e.canonical_form,
        json_extract(lc.translation_snapshot, '$.payload.contextualMeaning') AS historical_meaning
      FROM recall_occurrences ro
      JOIN expressions e ON e.id = ro.expression_id
      LEFT JOIN learning_contexts lc ON lc.expression_id = e.id AND lc.status = 'active'
      WHERE ro.id = ? ORDER BY lc.created_at DESC LIMIT 1
    `).get(occurrenceId) as unknown as (OccurrenceRow & {
      canonical_form: string;
      historical_meaning: string | null;
    }) | undefined;
    return row === undefined ? null : {
      ...mapOccurrence(row),
      canonicalForm: row.canonical_form,
      historicalMeaning: row.historical_meaning ?? "",
    };
  }

  saveAttempt(result: RecallEvaluation): void {
    this.connection.prepare(`
      INSERT INTO recall_attempts (
        id, occurrence_id, operation_id, user_interpretation, evaluation_snapshot, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      result.recallAttemptId,
      result.occurrenceId,
      result.operationId,
      result.userInterpretation,
      JSON.stringify({
        schemaVersion: 1,
        type: "recall.evaluation",
        payload: {
          verdict: result.verdict,
          feedback: result.feedback,
          contextualMeaning: result.contextualMeaning,
          missingPoints: result.missingPoints,
        },
      }),
      result.createdAt,
    );
  }
}

function mapOccurrence(row: OccurrenceRow): RecallOccurrence {
  return {
    occurrenceId: row.id,
    expressionId: row.expression_id,
    documentId: row.document_id,
    revisionId: row.revision_id,
    blockId: row.block_id,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    surfaceForm: row.surface_form,
    currentContext: row.current_context_snapshot,
    createdAt: row.created_at,
  };
}
