import { z } from "zod";

import { readingSceneSchema } from "./scene.js";
import { semanticPointSchema } from "./translation.js";

export const conversationIntentSchema = z.enum([
  "explain",
  "question",
  "translate",
  "summarize",
  "compare",
  "generate",
  "verify",
]);

export const conversationReferenceTypeSchema = z.enum([
  "current_selection",
  "paragraph",
  "conversation_turn",
]);

export const conversationReferenceInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("current_selection"),
    start: semanticPointSchema,
    end: semanticPointSchema,
    selectedText: z.string().min(1).max(36_000),
  }),
  z.object({ type: z.literal("paragraph"), targetId: z.string().min(1) }),
  z.object({ type: z.literal("conversation_turn"), targetId: z.string().min(1) }),
]);

export const conversationReferenceSchema = z.object({
  referenceId: z.string().min(1),
  type: conversationReferenceTypeSchema,
  targetId: z.string().min(1).nullable(),
  label: z.string().min(1),
  content: z.string().min(1),
  documentId: z.string().min(1),
  revisionId: z.string().min(1),
  selectionFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  start: semanticPointSchema.nullable(),
  end: semanticPointSchema.nullable(),
});

export const conversationAnswerOutcomeSchema = z.enum(["answered", "insufficient_evidence"]);
export const knowledgeBoundarySchema = z.enum([
  "document_grounded",
  "mixed",
  "model_knowledge",
]);

export const conversationAnswerSchema = z.object({
  answerId: z.string().min(1),
  operationId: z.string().min(1),
  content: z.string().min(1),
  citationReferenceIds: z.array(z.string().min(1)),
  outcome: conversationAnswerOutcomeSchema,
  knowledgeBoundary: knowledgeBoundarySchema,
  createdAt: z.string().datetime(),
});

export const aiFootnoteStatusSchema = z.enum(["active", "archived"]);

export const aiFootnoteSchema = z.object({
  footnoteId: z.string().min(1),
  documentId: z.string().min(1),
  revisionId: z.string().min(1),
  conversationId: z.string().min(1),
  turnId: z.string().min(1),
  capabilityId: z.string().min(1),
  selectionFingerprint: z.string().min(1),
  selectedText: z.string().min(1),
  start: semanticPointSchema,
  end: semanticPointSchema,
  status: aiFootnoteStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const conversationTurnSchema = z.object({
  turnId: z.string().min(1),
  question: z.string().max(4000),
  intent: conversationIntentSchema,
  capabilityId: z.string().min(1),
  footnoteEligible: z.boolean(),
  references: z.array(conversationReferenceSchema),
  answer: conversationAnswerSchema,
  footnote: aiFootnoteSchema.nullable(),
  createdAt: z.string().datetime(),
});

export const conversationSchema = z.object({
  conversationId: z.string().min(1),
  sceneId: readingSceneSchema,
  documentId: z.string().min(1),
  revisionId: z.string().min(1),
  title: z.string().min(1).max(80),
  turns: z.array(conversationTurnSchema),
  footnotes: z.array(aiFootnoteSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const openConversationRequestSchema = z.object({
  revisionId: z.string().min(1),
});

export const createConversationTurnRequestSchema = z.object({
  question: z.string().trim().max(4000).default(""),
  references: z.array(conversationReferenceInputSchema).max(12).default([]),
  intentHint: conversationIntentSchema.optional(),
});

export const aiFootnoteListSchema = z.array(aiFootnoteSchema);

export type ReadingConversation = z.infer<typeof conversationSchema>;
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;
export type ConversationReference = z.infer<typeof conversationReferenceSchema>;
export type ConversationReferenceInput = z.infer<typeof conversationReferenceInputSchema>;
export type ConversationIntent = z.infer<typeof conversationIntentSchema>;
export type ConversationAnswer = z.infer<typeof conversationAnswerSchema>;
export type KnowledgeBoundary = z.infer<typeof knowledgeBoundarySchema>;
export type AiFootnote = z.infer<typeof aiFootnoteSchema>;
export type OpenConversationRequest = z.infer<typeof openConversationRequestSchema>;
export type CreateConversationTurnRequest = z.infer<typeof createConversationTurnRequestSchema>;
