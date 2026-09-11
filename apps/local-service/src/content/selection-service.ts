import { createHash } from "node:crypto";

import type { SemanticSelection, TranslateSelectionRequest } from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

import { ApplicationError } from "../application/errors.js";
import type { SelectionNormalizerPort } from "../application/ports.js";

interface BlockRow {
  id: string;
  block_order: number;
  text: string;
  mapping_kind: string;
  source_start_offset: number;
  source_end_offset: number;
}

function selectionFingerprint(input: {
  revisionId: string;
  startBlockId: string;
  startOffset: number;
  endBlockId: string;
  endOffset: number;
  selectedText: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

function cutsSurrogatePair(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  const previous = text.charCodeAt(offset - 1);
  const current = text.charCodeAt(offset);
  return previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff;
}

interface TextRange {
  start: number;
  end: number;
}

export function sentenceRangeForSelection(text: string, selection: TextRange): TextRange {
  if (typeof Intl.Segmenter === "function") {
    const segments = Array.from(new Intl.Segmenter("en", { granularity: "sentence" }).segment(text));
    const overlapping = segments.filter((segment) => {
      const end = segment.index + segment.segment.length;
      return segment.index < selection.end && end > selection.start;
    });
    const first = overlapping[0];
    const last = overlapping.at(-1);
    if (first !== undefined && last !== undefined) {
      return trimWhitespace(text, {
        start: first.index,
        end: last.index + last.segment.length,
      });
    }
  }

  let start = selection.start;
  while (start > 0 && !/[.!?]/u.test(text[start - 1] ?? "")) start -= 1;
  let end = selection.end;
  while (end < text.length && !/[.!?]/u.test(text[end] ?? "")) end += 1;
  if (end < text.length) end += 1;
  return trimWhitespace(text, { start, end });
}

function trimWhitespace(text: string, range: TextRange): TextRange {
  let start = range.start;
  let end = range.end;
  while (start < end && /\s/u.test(text[start] ?? "")) start += 1;
  while (end > start && /\s/u.test(text[end - 1] ?? "")) end -= 1;
  return { start, end };
}

function markedDirectContext(
  blocks: readonly BlockRow[],
  startBlockId: string,
  startOffset: number,
  endBlockId: string,
  endOffset: number,
): string {
  return blocks.map((block) => {
    const focusStart = block.id === startBlockId ? startOffset : 0;
    const focusEnd = block.id === endBlockId ? endOffset : block.text.length;
    const sentence = sentenceRangeForSelection(block.text, { start: focusStart, end: focusEnd });
    return [
      block.text.slice(sentence.start, focusStart),
      "<lumen-focus>",
      block.text.slice(focusStart, focusEnd),
      "</lumen-focus>",
      block.text.slice(focusEnd, sentence.end),
    ].join("");
  }).join("\n\n");
}

export class SelectionService implements SelectionNormalizerPort {
  constructor(private readonly connection: DatabaseSync) {}

  normalize(documentId: string, input: TranslateSelectionRequest, selectionId: string): {
    selection: SemanticSelection;
    directContext: string;
    surroundingContext: string;
  } {
    const document = this.connection
      .prepare("SELECT active_revision_id FROM documents WHERE id = ? AND status = 'ready'")
      .get(documentId) as { active_revision_id: string } | undefined;
    if (document?.active_revision_id !== input.revisionId) {
      throw this.invalid("选区不属于文档当前版本");
    }
    const endpoints = this.connection
      .prepare(`
        SELECT sb.id, sb.block_order, sb.text, sm.mapping_kind,
          sm.source_start_offset, sm.source_end_offset
        FROM semantic_blocks sb
        JOIN source_mappings sm
          ON sm.revision_id = sb.revision_id
          AND sm.block_id = sb.id
        WHERE sb.id IN (?, ?) AND sb.revision_id = ?
        ORDER BY sb.block_order
      `)
      .all(input.start.blockId, input.end.blockId, input.revisionId) as unknown as BlockRow[];
    const startBlock = endpoints.find((block) => block.id === input.start.blockId);
    const endBlock = endpoints.find((block) => block.id === input.end.blockId);
    if (
      startBlock === undefined ||
      endBlock === undefined ||
      startBlock.block_order > endBlock.block_order ||
      input.start.offset < 0 ||
      input.start.offset > startBlock.text.length ||
      input.end.offset < 0 ||
      input.end.offset > endBlock.text.length ||
      (startBlock.id === endBlock.id && input.end.offset <= input.start.offset) ||
      cutsSurrogatePair(startBlock.text, input.start.offset) ||
      cutsSurrogatePair(endBlock.text, input.end.offset)
    ) {
      throw this.invalid("选区位置超出语义块范围");
    }

    const blocks = this.connection.prepare(`
      SELECT sb.id, sb.block_order, sb.text, sm.mapping_kind,
        sm.source_start_offset, sm.source_end_offset
      FROM semantic_blocks sb
      JOIN source_mappings sm
        ON sm.revision_id = sb.revision_id
        AND sm.block_id = sb.id
      WHERE sb.revision_id = ? AND sb.block_order BETWEEN ? AND ?
      ORDER BY sb.block_order
    `).all(
      input.revisionId,
      startBlock.block_order,
      endBlock.block_order,
    ) as unknown as BlockRow[];
    const reconstructed = blocks.map((block) => {
      const startOffset = block.id === startBlock.id ? input.start.offset : 0;
      const endOffset = block.id === endBlock.id ? input.end.offset : block.text.length;
      return block.text.slice(startOffset, endOffset);
    }).join("\n\n");
    if (reconstructed !== input.selectedText) {
      throw this.invalid("选区文本与服务端语义内容不一致");
    }
    if (reconstructed.trim().length === 0) {
      throw this.invalid("不能翻译空白选区");
    }

    const nearby = this.connection
      .prepare(`
        SELECT text FROM semantic_blocks
        WHERE revision_id = ? AND block_order BETWEEN ? AND ?
        ORDER BY block_order
      `)
      .all(
        input.revisionId,
        Math.max(0, startBlock.block_order - 1),
        endBlock.block_order + 1,
      ) as Array<{
        text: string;
      }>;
    const fingerprint = selectionFingerprint({
      revisionId: input.revisionId,
      startBlockId: input.start.blockId,
      startOffset: input.start.offset,
      endBlockId: input.end.blockId,
      endOffset: input.end.offset,
      selectedText: reconstructed,
    });

    return {
      selection: {
        selectionId,
        documentId,
        revisionId: input.revisionId,
        start: input.start,
        end: input.end,
        selectedText: reconstructed,
        sourceRanges: blocks.map((block) => ({
          blockId: block.id,
          semanticStartOffset: block.id === startBlock.id ? input.start.offset : 0,
          semanticEndOffset: block.id === endBlock.id ? input.end.offset : block.text.length,
          source: {
            kind: block.mapping_kind.replaceAll("_", "-"),
            startOffset: block.source_start_offset,
            endOffset: block.source_end_offset,
          },
        })),
        fingerprint,
      },
      directContext: markedDirectContext(
        blocks,
        startBlock.id,
        input.start.offset,
        endBlock.id,
        input.end.offset,
      ),
      surroundingContext: nearby.map((row) => row.text).filter(Boolean).join("\n\n"),
    };
  }

  private invalid(message: string): ApplicationError {
    return new ApplicationError({ code: "SELECTION_INVALID", message, statusCode: 409 });
  }
}
