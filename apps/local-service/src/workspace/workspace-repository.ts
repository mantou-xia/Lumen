import {
  workspaceReferenceSchema,
  workspaceSessionSchema,
  type WorkspaceReference,
  type WorkspaceReferenceInput,
  type WorkspaceSession,
  type WorkspaceTurn,
} from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

import type { WorkspaceRepositoryPort } from "../application/ports.js";

interface SessionRow {
  id: string;
  document_id: string;
  revision_id: string;
  created_at: string;
  updated_at: string;
}

interface TurnRow {
  id: string;
  question: string;
  created_at: string;
  answer_id: string;
  operation_id: string;
  answer_content: string;
  citation_reference_ids_snapshot: string;
  answer_created_at: string;
}

interface ReferenceRow {
  reference_snapshot: string;
}

export class WorkspaceRepository implements WorkspaceRepositoryPort {
  constructor(private readonly connection: DatabaseSync) {}

  getOrCreateSession(input: {
    sessionId: string;
    documentId: string;
    revisionId: string;
    now: string;
  }): WorkspaceSession | null {
    const revision = this.connection.prepare(`
      SELECT 1 FROM document_revisions WHERE id = ? AND document_id = ?
    `).get(input.revisionId, input.documentId);
    if (revision === undefined) return null;
    this.connection.prepare(`
      INSERT INTO workspace_sessions (id, document_id, revision_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(document_id, revision_id) DO NOTHING
    `).run(input.sessionId, input.documentId, input.revisionId, input.now, input.now);
    const row = this.connection.prepare(`
      SELECT id FROM workspace_sessions WHERE document_id = ? AND revision_id = ?
    `).get(input.documentId, input.revisionId) as { id: string };
    return this.getSession(row.id);
  }

  getSession(sessionId: string): WorkspaceSession | null {
    const session = this.connection.prepare(`
      SELECT id, document_id, revision_id, created_at, updated_at
      FROM workspace_sessions WHERE id = ?
    `).get(sessionId) as unknown as SessionRow | undefined;
    if (session === undefined) return null;
    return workspaceSessionSchema.parse({
      sessionId: session.id,
      documentId: session.document_id,
      revisionId: session.revision_id,
      turns: this.readTurns(session.id),
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    });
  }

  resolveReference(
    sessionId: string,
    input: WorkspaceReferenceInput,
    referenceId: string,
  ): WorkspaceReference | null {
    const session = this.connection.prepare(`
      SELECT document_id, revision_id FROM workspace_sessions WHERE id = ?
    `).get(sessionId) as { document_id: string; revision_id: string } | undefined;
    if (session === undefined) return null;
    if (input.type === "selection") return null;
    const common = {
      referenceId,
      type: input.type,
      targetId: input.targetId,
      documentId: session.document_id,
      revisionId: session.revision_id,
    };

    if (input.type === "paragraph") {
      const row = this.connection.prepare(`
        SELECT id, text FROM semantic_blocks
        WHERE id = ? AND revision_id = ?
      `).get(input.targetId, session.revision_id) as { id: string; text: string } | undefined;
      if (row === undefined || row.text.trim().length === 0) return null;
      return workspaceReferenceSchema.parse({
        ...common,
        label: `段落：${row.text.slice(0, 80)}`,
        content: row.text,
        start: { blockId: row.id, offset: 0 },
        end: { blockId: row.id, offset: row.text.length },
      });
    }

    if (input.type === "translation") {
      const row = this.connection.prepare(`
        SELECT selected_text, surrounding_context, contextual_translation,
          contextual_meaning, start_block_id, start_offset, end_block_id, end_offset
        FROM translations
        WHERE id = ? AND document_id = ? AND revision_id = ?
      `).get(input.targetId, session.document_id, session.revision_id) as {
        selected_text: string;
        surrounding_context: string;
        contextual_translation: string;
        contextual_meaning: string;
        start_block_id: string;
        start_offset: number;
        end_block_id: string;
        end_offset: number;
      } | undefined;
      if (row === undefined) return null;
      return workspaceReferenceSchema.parse({
        ...common,
        label: `翻译：${row.selected_text}`,
        content: [
          `原文：${row.selected_text}`,
          `语境：${row.surrounding_context}`,
          `翻译：${row.contextual_translation}`,
          `含义：${row.contextual_meaning}`,
        ].join("\n"),
        start: { blockId: row.start_block_id, offset: row.start_offset },
        end: { blockId: row.end_block_id, offset: row.end_offset },
      });
    }

    if (input.type === "learning_context") {
      const row = this.connection.prepare(`
        SELECT surface_form, surrounding_context_snapshot, translation_snapshot,
          start_block_id, start_offset, end_block_id, end_offset
        FROM learning_contexts
        WHERE id = ? AND document_id = ? AND revision_id = ?
      `).get(input.targetId, session.document_id, session.revision_id) as {
        surface_form: string;
        surrounding_context_snapshot: string;
        translation_snapshot: string;
        start_block_id: string;
        start_offset: number;
        end_block_id: string;
        end_offset: number;
      } | undefined;
      if (row === undefined) return null;
      const translation = JSON.parse(row.translation_snapshot) as {
        payload?: { contextualTranslation?: string; contextualMeaning?: string };
      };
      return workspaceReferenceSchema.parse({
        ...common,
        label: `学习语境：${row.surface_form}`,
        content: [
          `表达：${row.surface_form}`,
          `语境：${row.surrounding_context_snapshot}`,
          `翻译：${translation.payload?.contextualTranslation ?? ""}`,
          `含义：${translation.payload?.contextualMeaning ?? ""}`,
        ].join("\n"),
        start: { blockId: row.start_block_id, offset: row.start_offset },
        end: { blockId: row.end_block_id, offset: row.end_offset },
      });
    }

    if (input.type === "annotation") {
      const row = this.connection.prepare(`
        SELECT selected_text_snapshot, note, start_block_id, start_offset,
          end_block_id, end_offset
        FROM annotations
        WHERE id = ? AND document_id = ? AND revision_id = ?
      `).get(input.targetId, session.document_id, session.revision_id) as {
        selected_text_snapshot: string;
        note: string;
        start_block_id: string;
        start_offset: number;
        end_block_id: string;
        end_offset: number;
      } | undefined;
      if (row === undefined) return null;
      return workspaceReferenceSchema.parse({
        ...common,
        label: `标注：${row.selected_text_snapshot}`,
        content: `原文：${row.selected_text_snapshot}\n用户笔记：${row.note}`,
        start: { blockId: row.start_block_id, offset: row.start_offset },
        end: { blockId: row.end_block_id, offset: row.end_offset },
      });
    }

    const row = this.connection.prepare(`
      SELECT wt.question, wa.content
      FROM workspace_turns wt
      JOIN workspace_answers wa ON wa.turn_id = wt.id
      WHERE wt.id = ? AND wt.session_id = ?
    `).get(input.targetId, sessionId) as { question: string; content: string } | undefined;
    if (row === undefined) return null;
    return workspaceReferenceSchema.parse({
      ...common,
      label: `历史问答：${row.question}`,
      content: `问题：${row.question}\n回答：${row.content}`,
      start: null,
      end: null,
    });
  }

  listRecentTurns(sessionId: string, limit: number): WorkspaceTurn[] {
    return this.readTurns(sessionId).slice(-limit);
  }

  saveTurn(input: { sessionId: string; turn: WorkspaceTurn }): void {
    this.connection.prepare(`
      INSERT INTO workspace_turns (id, session_id, question, created_at)
      VALUES (?, ?, ?, ?)
    `).run(input.turn.turnId, input.sessionId, input.turn.question, input.turn.createdAt);
    const insertReference = this.connection.prepare(`
      INSERT INTO workspace_turn_references (
        id, turn_id, reference_type, target_id, reference_snapshot, reference_order
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    input.turn.references.forEach((reference, index) => insertReference.run(
      reference.referenceId,
      input.turn.turnId,
      reference.type,
      reference.targetId ?? reference.referenceId,
      JSON.stringify(reference),
      index,
    ));
    this.connection.prepare(`
      INSERT INTO workspace_answers (
        id, turn_id, operation_id, content, citation_reference_ids_snapshot, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.turn.answer.answerId,
      input.turn.turnId,
      input.turn.answer.operationId,
      input.turn.answer.content,
      JSON.stringify(input.turn.answer.citationReferenceIds),
      input.turn.answer.createdAt,
    );
    this.connection.prepare(`
      UPDATE workspace_sessions SET updated_at = ? WHERE id = ?
    `).run(input.turn.answer.createdAt, input.sessionId);
  }

  private readTurns(sessionId: string): WorkspaceTurn[] {
    const turns = this.connection.prepare(`
      SELECT wt.id, wt.question, wt.created_at,
        wa.id AS answer_id, wa.operation_id, wa.content AS answer_content,
        wa.citation_reference_ids_snapshot, wa.created_at AS answer_created_at
      FROM workspace_turns wt
      JOIN workspace_answers wa ON wa.turn_id = wt.id
      WHERE wt.session_id = ?
      ORDER BY wt.created_at, wt.rowid
    `).all(sessionId) as unknown as TurnRow[];
    const readReferences = this.connection.prepare(`
      SELECT reference_snapshot FROM workspace_turn_references
      WHERE turn_id = ? ORDER BY reference_order
    `);
    return turns.map((turn) => ({
      turnId: turn.id,
      question: turn.question,
      references: (readReferences.all(turn.id) as unknown as ReferenceRow[])
        .map((row) => workspaceReferenceSchema.parse(JSON.parse(row.reference_snapshot))),
      answer: {
        answerId: turn.answer_id,
        operationId: turn.operation_id,
        content: turn.answer_content,
        citationReferenceIds: JSON.parse(turn.citation_reference_ids_snapshot) as string[],
        createdAt: turn.answer_created_at,
      },
      createdAt: turn.created_at,
    }));
  }
}
