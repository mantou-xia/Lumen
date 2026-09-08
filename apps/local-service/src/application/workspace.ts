import type {
  CreateWorkspaceTurnRequest,
  WorkspaceReference,
  WorkspaceSession,
  WorkspaceTurn,
} from "@lumen/api-contract";

import { ApplicationError } from "./errors.js";
import type { WorkspaceApplicationDependencies } from "./ports.js";

export class WorkspaceApplication {
  constructor(private readonly dependencies: WorkspaceApplicationDependencies) {}

  open(documentId: string, revisionId: string): WorkspaceSession {
    const session = this.dependencies.transaction.run(() =>
      this.dependencies.repository.getOrCreateSession({
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
    const recentTurns = this.dependencies.repository.listRecentTurns(sessionId, 6);
    const operationId = this.dependencies.ids.generate();
    const createdAt = this.dependencies.clock.now();
    this.dependencies.transaction.run(() => {
      this.dependencies.operations.createOperation({
        operationId,
        taskType: "workspace.answer",
        taskVersion: "workspace.answer.v1",
        documentId: session.documentId,
        revisionId: session.revisionId,
        contextSnapshot: JSON.stringify({
          schemaVersion: 1,
          type: "workspace.answer.intent",
          payload: { question: input.question, references },
        }),
        now: createdAt,
      });
      this.dependencies.operations.markOperationRunning(operationId, createdAt);
    });

    try {
      const output = await this.dependencies.runtime.executeWorkspace({
        operationId,
        question: input.question,
        references,
        conversation: recentTurns.map((turn) => ({
          question: turn.question,
          answer: turn.answer.content,
        })),
        ...(signal === undefined ? {} : { signal }),
      });
      const completedAt = this.dependencies.clock.now();
      const turn: WorkspaceTurn = {
        turnId: this.dependencies.ids.generate(),
        question: input.question,
        references,
        answer: {
          answerId: this.dependencies.ids.generate(),
          operationId,
          content: output.content,
          citationReferenceIds: output.citationReferenceIds,
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
}

function workspaceSessionNotFound(): ApplicationError {
  return new ApplicationError({
    code: "WORKSPACE_SESSION_NOT_FOUND",
    message: "未找到指定 Workspace Session",
    statusCode: 404,
  });
}
