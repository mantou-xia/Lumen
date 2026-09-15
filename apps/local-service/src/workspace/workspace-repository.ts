import {
  workspaceReferenceSchema,
  workspaceSessionSchema,
  type WorkspaceReference,
  type WorkspaceReferenceInput,
  type WorkspaceSession,
  type WorkspaceSessionSummary,
  type WorkspaceTurn,
} from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

import type { WorkspaceRepositoryPort } from "../application/ports.js";

interface SessionRow {
  id: string;
  document_id: string;
  revision_id: string;
  title: string;
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
  outcome: "answered" | "insufficient_evidence";
  context_mode: "full_document" | "retrieved_document" | "explicit_references_only";
  context_stats_snapshot: string;
  context_references_snapshot: string;
  answer_created_at: string;
}

interface ReferenceRow {
  reference_snapshot: string;
}

export class WorkspaceRepository implements WorkspaceRepositoryPort {
  constructor(private readonly connection: DatabaseSync) {}

  openLatestOrCreateSession(input: {
    sessionId: string;
    documentId: string;
    revisionId: string;
    now: string;
  }): WorkspaceSession | null {
    const revision = this.connection.prepare(`
      SELECT 1 FROM document_revisions WHERE id = ? AND document_id = ?
    `).get(input.revisionId, input.documentId);
    if (revision === undefined) return null;
    const row = this.connection.prepare(`
      SELECT id FROM workspace_sessions
      WHERE document_id = ? AND revision_id = ?
      ORDER BY updated_at DESC, created_at DESC, rowid DESC LIMIT 1
    `).get(input.documentId, input.revisionId) as { id: string } | undefined;
    return row === undefined ? this.createSession(input) : this.getSession(row.id);
  }

  createSession(input: {
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
      INSERT INTO workspace_sessions (id, document_id, revision_id, title, created_at, updated_at)
      VALUES (?, ?, ?, '新会话', ?, ?)
    `).run(input.sessionId, input.documentId, input.revisionId, input.now, input.now);
    return this.getSession(input.sessionId);
  }

  listSessions(documentId: string, revisionId: string): WorkspaceSessionSummary[] {
    const rows = this.connection.prepare(`
      SELECT id, document_id, revision_id, title, created_at, updated_at
      FROM workspace_sessions WHERE document_id = ? AND revision_id = ?
      ORDER BY updated_at DESC, created_at DESC, rowid DESC
    `).all(documentId, revisionId) as unknown as SessionRow[];
    return rows.map((row) => ({
      sessionId: row.id,
      documentId: row.document_id,
      revisionId: row.revision_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getSession(sessionId: string): WorkspaceSession | null {
    const session = this.connection.prepare(`
      SELECT id, document_id, revision_id, title, created_at, updated_at
      FROM workspace_sessions WHERE id = ?
    `).get(sessionId) as unknown as SessionRow | undefined;
    if (session === undefined) return null;
    return workspaceSessionSchema.parse({
      sessionId: session.id,
      documentId: session.document_id,
      revisionId: session.revision_id,
      title: session.title,
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
      sourceRole: "explicit" as const,
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

  listSemanticBlocks(revisionId: string) {
    return this.connection.prepare(`
      SELECT id AS blockId, block_type AS blockType, block_order AS blockOrder, text
      FROM semantic_blocks WHERE revision_id = ? AND trim(text) <> '' ORDER BY block_order
    `).all(revisionId) as Array<{
      blockId: string; blockType: string; blockOrder: number; text: string;
    }>;
  }

  searchSemanticBlocks(revisionId: string, query: string, limit: number) {
    if (query.trim().length === 0) return [];
    return this.connection.prepare(`
      SELECT sb.id AS blockId, sb.block_type AS blockType,
        sb.block_order AS blockOrder, sb.text
      FROM semantic_block_fts fts
      JOIN semantic_blocks sb ON sb.id = fts.block_id
      WHERE fts.revision_id = ? AND semantic_block_fts MATCH ?
      ORDER BY bm25(semantic_block_fts), sb.block_order LIMIT ?
    `).all(revisionId, query, limit) as Array<{
      blockId: string; blockType: string; blockOrder: number; text: string;
    }>;
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
    [...input.turn.references, ...input.turn.contextReferences].forEach((reference, index) => insertReference.run(
      reference.referenceId,
      input.turn.turnId,
      reference.type,
      reference.targetId ?? reference.referenceId,
      JSON.stringify(reference),
      index,
    ));
    this.connection.prepare(`
      INSERT INTO workspace_answers (
        id, turn_id, operation_id, content, citation_reference_ids_snapshot,
        outcome, context_mode, context_stats_snapshot, context_references_snapshot, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.turn.answer.answerId,
      input.turn.turnId,
      input.turn.answer.operationId,
      input.turn.answer.content,
      JSON.stringify(input.turn.answer.citationReferenceIds),
      input.turn.answer.outcome,
      input.turn.answer.contextMode,
      JSON.stringify(input.turn.answer.contextStats),
      JSON.stringify(input.turn.contextReferences),
      input.turn.answer.createdAt,
    );
    this.connection.prepare(`
      UPDATE workspace_sessions
      SET updated_at = ?, title = CASE WHEN title = '新会话' THEN ? ELSE title END
      WHERE id = ?
    `).run(input.turn.answer.createdAt, sessionTitle(input.turn.question), input.sessionId);
  }

  private readTurns(sessionId: string): WorkspaceTurn[] {
    const turns = this.connection.prepare(`
      SELECT wt.id, wt.question, wt.created_at,
        wa.id AS answer_id, wa.operation_id, wa.content AS answer_content,
        wa.citation_reference_ids_snapshot, wa.outcome, wa.context_mode,
        wa.context_stats_snapshot, wa.context_references_snapshot,
        wa.created_at AS answer_created_at
      FROM workspace_turns wt
      JOIN workspace_answers wa ON wa.turn_id = wt.id
      WHERE wt.session_id = ?
      ORDER BY wt.created_at, wt.rowid
    `).all(sessionId) as unknown as TurnRow[];
    const readReferences = this.connection.prepare(`
      SELECT reference_snapshot FROM workspace_turn_references
      WHERE turn_id = ? ORDER BY reference_order
    `);
    return turns.map((turn) => {
      const allReferences = (readReferences.all(turn.id) as unknown as ReferenceRow[])
        .map((row) => workspaceReferenceSchema.parse(JSON.parse(row.reference_snapshot)));
      return ({
      turnId: turn.id,
      question: turn.question,
      references: allReferences.filter((reference) => reference.sourceRole === "explicit"),
      contextReferences: workspaceReferenceSchema.array().parse(JSON.parse(turn.context_references_snapshot)),
      answer: {
        answerId: turn.answer_id,
        operationId: turn.operation_id,
        content: turn.answer_content,
        citationReferenceIds: JSON.parse(turn.citation_reference_ids_snapshot) as string[],
        outcome: turn.outcome,
        contextMode: turn.context_mode,
        contextStats: JSON.parse(turn.context_stats_snapshot),
        createdAt: turn.answer_created_at,
      },
      createdAt: turn.created_at,
    });
    });
  }
}

function sessionTitle(question: string): string {
  const normalized = question.trim().replace(/\s+/gu, " ");
  return normalized.length <= 28 ? normalized : `${normalized.slice(0, 28)}…`;
}
