import type {
  CreateWorkspaceTurnRequest,
  WorkspaceContextMode,
  WorkspaceReference,
  WorkspaceSession,
  WorkspaceSessionSummary,
  WorkspaceTurn,
} from "@lumen/api-contract";

import { ApplicationError } from "./errors.js";
import type { WorkspaceApplicationDependencies } from "./ports.js";

export class WorkspaceApplication {
  constructor(private readonly dependencies: WorkspaceApplicationDependencies) {}

  open(documentId: string, revisionId: string, createNew = false): WorkspaceSession {
    const session = this.dependencies.transaction.run(() =>
      (createNew
        ? this.dependencies.repository.createSession.bind(this.dependencies.repository)
        : this.dependencies.repository.openLatestOrCreateSession.bind(this.dependencies.repository))({
        sessionId: this.dependencies.ids.generate(),
        documentId,
        revisionId,
        now: this.dependencies.clock.now(),
      }),
    );
    if (session === null) {
      throw new ApplicationError({
        code: "DOCUMENT_REVISION_NOT_FOUND",
        message: "Workspace 指定的文档版本不存在",
        statusCode: 404,
      });
    }
    return session;
  }

  list(documentId: string, revisionId: string): WorkspaceSessionSummary[] {
    return this.dependencies.repository.listSessions(documentId, revisionId);
  }

  get(sessionId: string): WorkspaceSession {
    const session = this.dependencies.repository.getSession(sessionId);
    if (session === null) throw workspaceSessionNotFound();
    return session;
  }

  async ask(
    sessionId: string,
    input: CreateWorkspaceTurnRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceTurn> {
    const session = this.get(sessionId);
    const references = input.references.map((reference): WorkspaceReference => {
      if (reference.type === "selection") {
        const normalized = this.dependencies.selection.normalize(
          session.documentId,
          {
            revisionId: session.revisionId,
            start: reference.start,
            end: reference.end,
            selectedText: reference.selectedText,
          },
          this.dependencies.ids.generate(),
        );
        return {
          referenceId: this.dependencies.ids.generate(),
          type: "selection",
          targetId: null,
          label: `选区：${normalized.selection.selectedText}`,
          content: [
            `选区：${normalized.selection.selectedText}`,
            `上下文：${normalized.surroundingContext}`,
          ].join("\n"),
          documentId: session.documentId,
          revisionId: session.revisionId,
          start: normalized.selection.start,
          end: normalized.selection.end,
          sourceRole: "explicit",
        };
      }
      const resolved = this.dependencies.repository.resolveReference(
        sessionId,
        reference,
        this.dependencies.ids.generate(),
      );
      if (resolved === null) {
        throw new ApplicationError({
          code: "WORKSPACE_REFERENCE_INVALID",
          message: "Workspace Reference 不存在或不属于当前文档版本",
          statusCode: 409,
        });
      }
      return resolved;
    });
    const context = await this.buildDocumentContext(session, input.question, references, signal);
    const operationId = this.dependencies.ids.generate();
    const createdAt = this.dependencies.clock.now();
    this.dependencies.transaction.run(() => {
      this.dependencies.operations.createOperation({
        operationId,
        taskType: "workspace.answer",
        taskVersion: "workspace.answer.v2",
        documentId: session.documentId,
        revisionId: session.revisionId,
        contextSnapshot: JSON.stringify({
          schemaVersion: 1,
          type: "workspace.answer.intent",
          payload: { question: input.question, references, context },
        }),
        now: createdAt,
      });
      this.dependencies.operations.markOperationRunning(operationId, createdAt);
    });

    try {
      const output = await this.dependencies.runtime.executeWorkspace({
        operationId,
        question: input.question,
        contextMode: context.mode,
        references: [...references, ...context.references],
        ...(signal === undefined ? {} : { signal }),
      });
      const completedAt = this.dependencies.clock.now();
      const turn: WorkspaceTurn = {
        turnId: this.dependencies.ids.generate(),
        question: input.question,
        references,
        contextReferences: context.references,
        answer: {
          answerId: this.dependencies.ids.generate(),
          operationId,
          content: output.content,
          citationReferenceIds: output.citationReferenceIds,
          outcome: output.outcome,
          contextMode: context.mode,
          contextStats: {
            explicitReferenceCount: references.length,
            retrievedBlockCount: context.references.length,
            includedCharacterCount: context.includedCharacterCount,
            truncated: context.truncated,
          },
          createdAt: completedAt,
        },
        createdAt,
      };
      this.dependencies.transaction.run(() => {
        this.dependencies.repository.saveTurn({ sessionId, turn });
        this.dependencies.operations.completeOperation(operationId, completedAt);
      });
      return turn;
    } catch (error) {
      const applicationError = error instanceof ApplicationError
        ? error
        : new ApplicationError({
            code: "MODEL_PROVIDER_FAILED",
            message: "Workspace 回答执行失败",
            retryable: true,
            statusCode: 502,
            cause: error,
          });
      this.dependencies.transaction.run(() => {
        if (applicationError.code === "OPERATION_CANCELLED") {
          this.dependencies.operations.cancelOperation(operationId, this.dependencies.clock.now());
        } else {
          this.dependencies.operations.failOperation(
            operationId,
            applicationError.code,
            applicationError.message,
            this.dependencies.clock.now(),
          );
        }
      });
      throw new ApplicationError({
        code: applicationError.code,
        message: applicationError.message,
        retryable: applicationError.retryable,
        operationId,
        statusCode: applicationError.statusCode,
        cause: applicationError,
      });
    }
  }

  private async buildDocumentContext(
    session: WorkspaceSession,
    question: string,
    explicitReferences: WorkspaceReference[],
    signal?: AbortSignal,
  ): Promise<{
    mode: WorkspaceContextMode;
    references: WorkspaceReference[];
    includedCharacterCount: number;
    truncated: boolean;
  }> {
    const budget = 36_000;
    const explicitCharacters = explicitReferences.reduce(
      (total, reference) => total + reference.content.length,
      0,
    );
    if (explicitCharacters > budget) {
      throw new ApplicationError({
        code: "WORKSPACE_CONTEXT_TOO_LARGE",
        message: "显式引用超过本轮上下文预算，请移除部分引用后重试",
        statusCode: 413,
      });
    }
    const remaining = budget - explicitCharacters;
    const blocks = this.dependencies.repository.listSemanticBlocks(session.revisionId);
    const fullCharacters = blocks.reduce((total, block) => total + block.text.length, 0);
    if (fullCharacters <= remaining) {
      const references = blocks.map((block) => this.documentReference(session, block));
      return {
        mode: references.length === 0 ? "explicit_references_only" : "full_document",
        references,
        includedCharacterCount: explicitCharacters + fullCharacters,
        truncated: false,
      };
    }

    const query = await this.rewriteQuery(session, question, signal);
    const hits = query.length === 0
      ? []
      : this.dependencies.repository.searchSemanticBlocks(session.revisionId, query, 12);
    const selectedOrders = new Set<number>();
    for (const hit of hits) {
      selectedOrders.add(hit.blockOrder);
      selectedOrders.add(hit.blockOrder - 1);
      selectedOrders.add(hit.blockOrder + 1);
      const heading = blocks.findLast(
        (block) => block.blockOrder < hit.blockOrder && block.blockType === "heading",
      );
      if (heading !== undefined) selectedOrders.add(heading.blockOrder);
    }
    const candidates = blocks.filter((block) => selectedOrders.has(block.blockOrder));
    const references: WorkspaceReference[] = [];
    let used = 0;
    for (const block of candidates) {
      if (used + block.text.length > remaining) continue;
      references.push(this.documentReference(session, block));
      used += block.text.length;
    }
    return {
      mode: references.length === 0 ? "explicit_references_only" : "retrieved_document",
      references,
      includedCharacterCount: explicitCharacters + used,
      truncated: references.length < candidates.length,
    };
  }

  private documentReference(
    session: WorkspaceSession,
    block: { blockId: string; blockType: string; blockOrder: number; text: string },
  ): WorkspaceReference {
    return {
      referenceId: this.dependencies.ids.generate(),
      type: "document_context",
      targetId: block.blockId,
      label: `文档块 ${block.blockOrder + 1}`,
      content: block.text,
      documentId: session.documentId,
      revisionId: session.revisionId,
      start: { blockId: block.blockId, offset: 0 },
      end: { blockId: block.blockId, offset: block.text.length },
      sourceRole: "retrieved",
    };
  }

  private async rewriteQuery(
    session: WorkspaceSession,
    question: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const operationId = this.dependencies.ids.generate();
    const now = this.dependencies.clock.now();
    this.dependencies.transaction.run(() => {
      this.dependencies.operations.createOperation({
        operationId,
        taskType: "workspace.query-rewrite",
        taskVersion: "workspace.query-rewrite.v1",
        documentId: session.documentId,
        revisionId: session.revisionId,
        contextSnapshot: JSON.stringify({ question }),
        now,
      });
      this.dependencies.operations.markOperationRunning(operationId, now);
    });
    try {
      const output = await this.dependencies.runtime.executeWorkspaceQueryRewrite({
        operationId,
        question,
        ...(signal === undefined ? {} : { signal }),
      });
      this.dependencies.operations.completeOperation(operationId, this.dependencies.clock.now());
      return safeFtsQuery(output.query) || safeFtsQuery(question);
    } catch {
      this.dependencies.operations.failOperation(
        operationId,
        "WORKSPACE_QUERY_REWRITE_FAILED",
        "Workspace 检索问题改写失败，已使用确定性降级",
        this.dependencies.clock.now(),
      );
      return safeFtsQuery(question);
    }
  }
}

function safeFtsQuery(value: string): string {
  const tokens = value.match(/[\p{L}\p{N}][\p{L}\p{N}_'-]*/gu) ?? [];
  return [...new Set(tokens.map((token) => token.toLocaleLowerCase("en-US")))]
    .slice(0, 12)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(" OR ");
}

function workspaceSessionNotFound(): ApplicationError {
  return new ApplicationError({
    code: "WORKSPACE_SESSION_NOT_FOUND",
    message: "未找到指定 Workspace Session",
    statusCode: 404,
  });
}
