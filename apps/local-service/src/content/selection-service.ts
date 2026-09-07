import { createHash, randomUUID } from "node:crypto";

import type { SemanticSelection, TranslateSelectionRequest } from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

import { ApplicationError } from "../application/errors.js";

interface BlockRow {
  id: string;
  block_order: number;
  text: string;
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

export class SelectionService {
  constructor(private readonly connection: DatabaseSync) {}

  normalize(documentId: string, input: TranslateSelectionRequest): {
    selection: SemanticSelection;
    surroundingContext: string;
  } {
    const document = this.connection
      .prepare("SELECT active_revision_id FROM documents WHERE id = ? AND status = 'ready'")
      .get(documentId) as { active_revision_id: string } | undefined;
    if (document?.active_revision_id !== input.revisionId) {
      throw this.invalid("选区不属于文档当前版本");
    }
    if (input.start.blockId !== input.end.blockId) {
      throw this.invalid("MVP 当前只支持同一段落内的稳定选区");
    }

    const block = this.connection
      .prepare(`
        SELECT id, block_order, text FROM semantic_blocks
        WHERE id = ? AND revision_id = ?
      `)
      .get(input.start.blockId, input.revisionId) as unknown as BlockRow | undefined;
    if (
      block === undefined ||
      input.start.offset < 0 ||
      input.end.offset <= input.start.offset ||
      input.end.offset > block.text.length
    ) {
      throw this.invalid("选区位置超出语义块范围");
    }

    const reconstructed = block.text.slice(input.start.offset, input.end.offset);
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
      .all(input.revisionId, Math.max(0, block.block_order - 1), block.block_order + 1) as Array<{
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
        selectionId: randomUUID(),
        documentId,
        revisionId: input.revisionId,
        start: input.start,
        end: input.end,
        selectedText: reconstructed,
        fingerprint,
      },
      surroundingContext: nearby.map((row) => row.text).filter(Boolean).join("\n\n"),
    };
  }

  private invalid(message: string): ApplicationError {
    return new ApplicationError({ code: "SELECTION_INVALID", message, statusCode: 409 });
  }
}
