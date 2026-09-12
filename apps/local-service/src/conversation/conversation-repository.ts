import {
  aiFootnoteSchema,
  conversationReferenceSchema,
  conversationSchema,
  type AiFootnote,
  type ConversationReference,
  type ConversationReferenceInput,
  type ConversationTurn,
  type ReadingConversation,
  type ReadingScene,
} from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

import type { ConversationRepositoryPort } from "../application/ports.js";

interface ConversationRow {
  id: string;
  scene_id: ReadingScene;
  document_id: string;
  revision_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface TurnRow {
  id: string;
  question: string;
  intent: ConversationTurn["intent"];
  capability_id: string;
  footnote_eligible: number;
  created_at: string;
  answer_id: string;
  operation_id: string;
  answer_content: string;
  citation_reference_ids_snapshot: string;
  outcome: ConversationTurn["answer"]["outcome"];
  knowledge_boundary: ConversationTurn["answer"]["knowledgeBoundary"];
  answer_created_at: string;
}

export class ConversationRepository implements ConversationRepositoryPort {
  constructor(private readonly connection: DatabaseSync) {}

  openLatestOrCreate(input: {
    conversationId: string;
    documentId: string;
    revisionId: string;
    now: string;
  }): ReadingConversation | null {
    const document = this.connection.prepare(`
      SELECT d.scene_id
      FROM documents d
      JOIN document_revisions revision ON revision.document_id = d.id
      WHERE d.id = ? AND revision.id = ?
    `).get(input.documentId, input.revisionId) as { scene_id: ReadingScene } | undefined;
    if (document === undefined) return null;
    const existing = this.connection.prepare(`
      SELECT id FROM conversations
      WHERE document_id = ? AND revision_id = ?
      ORDER BY updated_at DESC, created_at DESC, rowid DESC LIMIT 1
    `).get(input.documentId, input.revisionId) as { id: string } | undefined;
    if (existing !== undefined) return this.getConversation(existing.id);
    this.connection.prepare(`
      INSERT INTO conversations (
        id, scene_id, document_id, revision_id, title, created_at, updated_at
      ) VALUES (?, ?, ?, ?, '新对话', ?, ?)
    `).run(
      input.conversationId,
      document.scene_id,
      input.documentId,
      input.revisionId,
      input.now,
      input.now,
    );
    return this.getConversation(input.conversationId);
  }

  getConversation(conversationId: string): ReadingConversation | null {
    const row = this.connection.prepare(`
      SELECT id, scene_id, document_id, revision_id, title, created_at, updated_at
      FROM conversations WHERE id = ?
    `).get(conversationId) as unknown as ConversationRow | undefined;
    if (row === undefined) return null;
    return conversationSchema.parse({
      conversationId: row.id,
      sceneId: row.scene_id,
      documentId: row.document_id,
      revisionId: row.revision_id,
      title: row.title,
      turns: this.readTurns(row.id),
      footnotes: this.readFootnotes(row.document_id, row.revision_id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  resolveReference(
    conversationId: string,
    input: ConversationReferenceInput,
    referenceId: string,
  ): ConversationReference | null {
    if (input.type === "current_selection") return null;
    const conversation = this.connection.prepare(`
      SELECT document_id, revision_id FROM conversations WHERE id = ?
    `).get(conversationId) as { document_id: string; revision_id: string } | undefined;
    if (conversation === undefined) return null;
    if (input.type === "paragraph") {
      const block = this.connection.prepare(`
        SELECT id, text FROM semantic_blocks WHERE id = ? AND revision_id = ?
      `).get(input.targetId, conversation.revision_id) as { id: string; text: string } | undefined;
      if (block === undefined || block.text.trim().length === 0) return null;
      return conversationReferenceSchema.parse({
        referenceId,
        type: input.type,
        targetId: block.id,
        label: `段落：${block.text.slice(0, 80)}`,
        content: block.text,
        documentId: conversation.document_id,
        revisionId: conversation.revision_id,
        selectionFingerprint: null,
        start: { blockId: block.id, offset: 0 },
        end: { blockId: block.id, offset: block.text.length },
      });
    }
    const turn = this.connection.prepare(`
      SELECT turn.question, answer.content
      FROM conversation_turns turn
      JOIN conversation_answers answer ON answer.turn_id = turn.id
      WHERE turn.id = ? AND turn.conversation_id = ?
    `).get(input.targetId, conversationId) as { question: string; content: string } | undefined;
    if (turn === undefined) return null;
    return conversationReferenceSchema.parse({
      referenceId,
      type: input.type,
      targetId: input.targetId,
      label: `历史问答：${turn.question || "解释选中内容"}`,
      content: `问题：${turn.question || "解释选中内容"}\n回答：${turn.content}`,
      documentId: conversation.document_id,
      revisionId: conversation.revision_id,
      selectionFingerprint: null,
      start: null,
      end: null,
    });
  }

  saveTurn(input: { conversationId: string; turn: ConversationTurn }): void {
    const { turn } = input;
    this.connection.prepare(`
      INSERT INTO conversation_turns (
        id, conversation_id, question, intent, capability_id, footnote_eligible, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      turn.turnId,
      input.conversationId,
      turn.question,
      turn.intent,
      turn.capabilityId,
      turn.footnoteEligible ? 1 : 0,
      turn.createdAt,
    );
    const insertReference = this.connection.prepare(`
      INSERT INTO conversation_turn_references (
        id, turn_id, reference_type, target_id, reference_snapshot, reference_order
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    turn.references.forEach((reference, index) => insertReference.run(
      reference.referenceId,
      turn.turnId,
      reference.type,
      reference.targetId,
      JSON.stringify(reference),
      index,
    ));
    this.connection.prepare(`
      INSERT INTO conversation_answers (
        id, turn_id, operation_id, content, citation_reference_ids_snapshot,
        outcome, knowledge_boundary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      turn.answer.answerId,
      turn.turnId,
      turn.answer.operationId,
      turn.answer.content,
      JSON.stringify(turn.answer.citationReferenceIds),
      turn.answer.outcome,
      turn.answer.knowledgeBoundary,
      turn.answer.createdAt,
    );
    if (turn.footnote !== null) {
      this.connection.prepare(`
        UPDATE ai_footnotes SET status = 'archived', updated_at = ?
        WHERE revision_id = ? AND selection_fingerprint = ?
          AND capability_id = ? AND status = 'active'
      `).run(
        turn.footnote.updatedAt,
        turn.footnote.revisionId,
        turn.footnote.selectionFingerprint,
        turn.footnote.capabilityId,
      );
      this.connection.prepare(`
        INSERT INTO ai_footnotes (
          id, document_id, revision_id, conversation_id, turn_id, capability_id,
          selection_fingerprint, selection_snapshot, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        turn.footnote.footnoteId,
        turn.footnote.documentId,
        turn.footnote.revisionId,
        turn.footnote.conversationId,
        turn.footnote.turnId,
        turn.footnote.capabilityId,
        turn.footnote.selectionFingerprint,
        JSON.stringify({
          selectedText: turn.footnote.selectedText,
          start: turn.footnote.start,
          end: turn.footnote.end,
        }),
        turn.footnote.status,
        turn.footnote.createdAt,
        turn.footnote.updatedAt,
      );
    }
    this.connection.prepare(`
      UPDATE conversations
      SET updated_at = ?, title = CASE WHEN title = '新对话' THEN ? ELSE title END
      WHERE id = ?
    `).run(turn.answer.createdAt, conversationTitle(turn), input.conversationId);
  }

  private readTurns(conversationId: string): ConversationTurn[] {
    const rows = this.connection.prepare(`
      SELECT turn.id, turn.question, turn.intent, turn.capability_id,
        turn.footnote_eligible, turn.created_at,
        answer.id AS answer_id, answer.operation_id, answer.content AS answer_content,
        answer.citation_reference_ids_snapshot, answer.outcome,
        answer.knowledge_boundary, answer.created_at AS answer_created_at
      FROM conversation_turns turn
      JOIN conversation_answers answer ON answer.turn_id = turn.id
      WHERE turn.conversation_id = ?
      ORDER BY turn.created_at, turn.rowid
    `).all(conversationId) as unknown as TurnRow[];
    const readReferences = this.connection.prepare(`
      SELECT reference_snapshot FROM conversation_turn_references
      WHERE turn_id = ? ORDER BY reference_order
    `);
    const readFootnote = this.connection.prepare(`
      SELECT * FROM ai_footnotes WHERE turn_id = ? ORDER BY created_at DESC LIMIT 1
    `);
    return rows.map((row) => ({
      turnId: row.id,
      question: row.question,
      intent: row.intent,
      capabilityId: row.capability_id,
      footnoteEligible: row.footnote_eligible === 1,
      references: (readReferences.all(row.id) as Array<{ reference_snapshot: string }>)
        .map((reference) => conversationReferenceSchema.parse(JSON.parse(reference.reference_snapshot))),
      answer: {
        answerId: row.answer_id,
        operationId: row.operation_id,
        content: row.answer_content,
        citationReferenceIds: JSON.parse(row.citation_reference_ids_snapshot) as string[],
        outcome: row.outcome,
        knowledgeBoundary: row.knowledge_boundary,
        createdAt: row.answer_created_at,
      },
      footnote: mapFootnote(readFootnote.get(row.id)),
      createdAt: row.created_at,
    }));
  }

  private readFootnotes(documentId: string, revisionId: string): AiFootnote[] {
    return (this.connection.prepare(`
      SELECT * FROM ai_footnotes
      WHERE document_id = ? AND revision_id = ? AND status = 'active'
      ORDER BY created_at, rowid
    `).all(documentId, revisionId) as unknown[]).map((row) => mapFootnote(row)!);
  }
}

function mapFootnote(value: unknown): AiFootnote | null {
  if (value === undefined) return null;
  const row = value as {
    id: string; document_id: string; revision_id: string; conversation_id: string;
    turn_id: string; capability_id: string; selection_fingerprint: string;
    selection_snapshot: string; status: "active" | "archived"; created_at: string; updated_at: string;
  };
  const selection = JSON.parse(row.selection_snapshot) as {
    selectedText: string; start: { blockId: string; offset: number }; end: { blockId: string; offset: number };
  };
  return aiFootnoteSchema.parse({
    footnoteId: row.id,
    documentId: row.document_id,
    revisionId: row.revision_id,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    capabilityId: row.capability_id,
    selectionFingerprint: row.selection_fingerprint,
    selectedText: selection.selectedText,
    start: selection.start,
    end: selection.end,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function conversationTitle(turn: ConversationTurn): string {
  const value = (turn.question || turn.references[0]?.content || "新对话").trim().replace(/\s+/gu, " ");
  return value.length <= 28 ? value : `${value.slice(0, 28)}…`;
}
