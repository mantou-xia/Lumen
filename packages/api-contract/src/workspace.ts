import { z } from "zod";

import { semanticPointSchema } from "./translation.js";

export const workspaceReferenceTypeSchema = z.enum([
  "selection",
  "paragraph",
  "translation",
  "learning_context",
  "annotation",
  "workspace_turn",
]);

export const workspaceReferenceInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("selection"),
    start: semanticPointSchema,
    end: semanticPointSchema,
    selectedText: z.string().min(1).max(2000),
  }),
  z.object({ type: z.literal("paragraph"), targetId: z.string().min(1) }),
  z.object({ type: z.literal("translation"), targetId: z.string().min(1) }),
  z.object({ type: z.literal("learning_context"), targetId: z.string().min(1) }),
  z.object({ type: z.literal("annotation"), targetId: z.string().min(1) }),
  z.object({ type: z.literal("workspace_turn"), targetId: z.string().min(1) }),
]);

export const workspaceReferenceSchema = z.object({
  referenceId: z.string().min(1),
  type: workspaceReferenceTypeSchema,
  targetId: z.string().min(1).nullable(),
  label: z.string().min(1),
  content: z.string().min(1),
  documentId: z.string().min(1),
  revisionId: z.string().min(1),
  start: semanticPointSchema.nullable(),
  end: semanticPointSchema.nullable(),
});

export const workspaceAnswerSchema = z.object({
  answerId: z.string().min(1),
  operationId: z.string().min(1),
  content: z.string().min(1),
  citationReferenceIds: z.array(z.string().min(1)),
  createdAt: z.string().datetime(),
});

export const workspaceTurnSchema = z.object({
  turnId: z.string().min(1),
  question: z.string().min(1).max(4000),
  references: z.array(workspaceReferenceSchema).min(1),
  answer: workspaceAnswerSchema,
  createdAt: z.string().datetime(),
});

export const workspaceSessionSchema = z.object({
  sessionId: z.string().min(1),
  documentId: z.string().min(1),
  revisionId: z.string().min(1),
  turns: z.array(workspaceTurnSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const openWorkspaceSessionRequestSchema = z.object({
  revisionId: z.string().min(1),
});

export const createWorkspaceTurnRequestSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  references: z.array(workspaceReferenceInputSchema).min(1).max(12),
});

export type WorkspaceReferenceType = z.infer<typeof workspaceReferenceTypeSchema>;
export type WorkspaceReferenceInput = z.infer<typeof workspaceReferenceInputSchema>;
export type WorkspaceReference = z.infer<typeof workspaceReferenceSchema>;
export type WorkspaceAnswer = z.infer<typeof workspaceAnswerSchema>;
export type WorkspaceTurn = z.infer<typeof workspaceTurnSchema>;
export type WorkspaceSession = z.infer<typeof workspaceSessionSchema>;
export type OpenWorkspaceSessionRequest = z.infer<typeof openWorkspaceSessionRequestSchema>;
export type CreateWorkspaceTurnRequest = z.infer<typeof createWorkspaceTurnRequestSchema>;
