import type {
  ConversationIntent,
  ConversationReference,
  ConversationTurn,
  CreateConversationTurnRequest,
  ReadingConversation,
} from "@lumen/api-contract";

import { ApplicationError } from "./errors.js";
import type { ConversationApplicationDependencies } from "./ports.js";

const nonExplainIntents: Array<[ConversationIntent, RegExp]> = [
  ["translate", /翻译|translate/iu],
  ["summarize", /总结|概括|摘要|summari[sz]e/iu],
  ["compare", /比较|对比|区别|compare|difference/iu],
  ["generate", /生成|写一|列出|generate|write/iu],
  ["verify", /验证|核实|是否正确|verify|fact.?check/iu],
];
const explainPattern = /解释|含义|什么意思|展开说|讲讲|说明|explain|what does|meaning/iu;

export class ConversationApplication {
  constructor(private readonly dependencies: ConversationApplicationDependencies) {}

  open(documentId: string, revisionId: string): ReadingConversation {
    const conversation = this.dependencies.transaction.run(() =>
      this.dependencies.repository.openLatestOrCreate({
        conversationId: this.dependencies.ids.generate(),
        documentId,
        revisionId,
        now: this.dependencies.clock.now(),
      }),
    );
    if (conversation === null) {
      throw new ApplicationError({
        code: "DOCUMENT_REVISION_NOT_FOUND",
        message: "对话指定的文档版本不存在",
        statusCode: 404,
      });
    }
    return conversation;
  }

  get(conversationId: string): ReadingConversation {
    const conversation = this.dependencies.repository.getConversation(conversationId);
    if (conversation === null) {
      throw new ApplicationError({
        code: "WORKSPACE_SESSION_NOT_FOUND",
        message: "未找到指定对话",
        statusCode: 404,
      });
    }
    return conversation;
  }

  async ask(
    conversationId: string,
    input: CreateConversationTurnRequest,
    signal?: AbortSignal,
  ): Promise<ConversationTurn> {
    const conversation = this.get(conversationId);
    const references = input.references.map((reference): ConversationReference => {
      if (reference.type === "current_selection") {
        const normalized = this.dependencies.selection.normalize(
          conversation.documentId,
          {
            revisionId: conversation.revisionId,
            start: reference.start,
            end: reference.end,
            selectedText: reference.selectedText,
          },
          this.dependencies.ids.generate(),
        );
        return {
          referenceId: this.dependencies.ids.generate(),
          type: "current_selection",
          targetId: null,
          label: `选区：${normalized.selection.selectedText}`,
          content: `选中内容：${normalized.selection.selectedText}\n直接语境：${normalized.directContext}`,
          documentId: conversation.documentId,
          revisionId: conversation.revisionId,
          selectionFingerprint: normalized.selection.fingerprint,
          start: normalized.selection.start,
          end: normalized.selection.end,
        };
      }
      const resolved = this.dependencies.repository.resolveReference(
        conversationId,
        reference,
        this.dependencies.ids.generate(),
      );
      if (resolved === null) {
        throw new ApplicationError({
          code: "WORKSPACE_REFERENCE_INVALID",
          message: "引用不存在或不属于当前文档版本",
          statusCode: 409,
        });
      }
      return resolved;
    });
    const intent = resolveIntent(input, references);
    if (input.question.length === 0 && intent !== "explain") {
      throw new ApplicationError({
        code: "WORKSPACE_REFERENCE_INVALID",
        message: "非解释请求需要输入问题",
        statusCode: 400,
      });
    }
    const singleSelection = references.length === 1 && references[0]?.type === "current_selection"
      ? references[0]
      : null;
    const footnoteEligible = intent === "explain" && singleSelection !== null;
    const capabilityId = conversation.sceneId === "technical_learning" && intent === "explain"
      ? "selection.technical-explanation.v1" as const
      : "conversation.question.v1" as const;
    const operationId = this.dependencies.ids.generate();
    const createdAt = this.dependencies.clock.now();
    const effectiveQuestion = input.question || "请解释选中的内容";
    this.dependencies.transaction.run(() => {
      this.dependencies.operations.createOperation({
        operationId,
        taskType: capabilityId.replace(/\.v1$/u, ""),
        taskVersion: capabilityId,
        documentId: conversation.documentId,
        revisionId: conversation.revisionId,
        contextSnapshot: JSON.stringify({
          schemaVersion: 1,
          type: "conversation.intent",
          payload: { sceneId: conversation.sceneId, intent, question: effectiveQuestion, references },
        }),
        now: createdAt,
      });
      this.dependencies.operations.markOperationRunning(operationId, createdAt);
    });
    try {
      const output = await this.dependencies.runtime.executeConversation({
        operationId,
        capabilityId,
        sceneId: conversation.sceneId,
        intent,
        question: effectiveQuestion,
        references,
        ...(signal === undefined ? {} : { signal }),
      });
      const completedAt = this.dependencies.clock.now();
      const turnId = this.dependencies.ids.generate();
      const turn: ConversationTurn = {
        turnId,
        question: input.question,
        intent,
        capabilityId,
        footnoteEligible,
        references,
        answer: {
          answerId: this.dependencies.ids.generate(),
          operationId,
          content: output.content,
          citationReferenceIds: output.citationReferenceIds,
          outcome: output.outcome,
          knowledgeBoundary: output.knowledgeBoundary,
          createdAt: completedAt,
        },
        footnote: footnoteEligible && output.outcome === "answered" && singleSelection !== null
          ? {
              footnoteId: this.dependencies.ids.generate(),
              documentId: conversation.documentId,
              revisionId: conversation.revisionId,
              conversationId,
              turnId,
              capabilityId,
              selectionFingerprint: singleSelection.selectionFingerprint!,
              selectedText: selectionText(singleSelection),
              start: singleSelection.start!,
              end: singleSelection.end!,
              status: "active",
              createdAt: completedAt,
              updatedAt: completedAt,
            }
          : null,
        createdAt,
      };
      this.dependencies.transaction.run(() => {
        this.dependencies.repository.saveTurn({ conversationId, turn });
        this.dependencies.operations.completeOperation(operationId, completedAt);
      });
      return turn;
    } catch (error) {
      const applicationError = error instanceof ApplicationError ? error : new ApplicationError({
        code: "MODEL_PROVIDER_FAILED",
        message: "AI 对话执行失败",
        retryable: true,
        statusCode: 502,
        cause: error,
      });
      this.dependencies.transaction.run(() => {
        if (applicationError.code === "OPERATION_CANCELLED") {
          this.dependencies.operations.cancelOperation(operationId, this.dependencies.clock.now());
          return;
        }
        this.dependencies.operations.failOperation(
          operationId,
          applicationError.code,
          applicationError.message,
          this.dependencies.clock.now(),
        );
      });
      throw applicationError;
    }
  }
}

function resolveIntent(
  input: CreateConversationTurnRequest,
  references: ConversationReference[],
): ConversationIntent {
  if (input.intentHint !== undefined) return input.intentHint;
  for (const [intent, pattern] of nonExplainIntents) {
    if (pattern.test(input.question)) return intent;
  }
  if (explainPattern.test(input.question)) return "explain";
  if (input.question.length === 0 && references.length === 1 && references[0]?.type === "current_selection") {
    return "explain";
  }
  return "question";
}

function selectionText(reference: ConversationReference): string {
  return /选中内容：(.*)\n直接语境：/su.exec(reference.content)?.[1] ?? reference.label.replace(/^选区：/u, "");
}
