import type { ConversationTurn, ReadingConversation } from "@lumen/api-contract";
import { describe, expect, it } from "vitest";

import {
  createLatestRequestController,
  createSynchronousRequestGuard,
  mergeConversationTurn,
} from "./conversation-state";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("latest explanation request", () => {
  it("关闭卡片后忽略延迟完成的恢复请求", async () => {
    const controller = createLatestRequestController();
    const request = deferred<string>();
    const token = controller.begin("footnote-a");
    let visibleResult: string | null = null;
    const completion = request.promise.then((result) => {
      if (controller.isCurrent(token)) visibleResult = result;
    });

    controller.invalidate();
    request.resolve("answer-a");
    await completion;

    expect(token.signal.aborted).toBe(true);
    expect(visibleResult).toBeNull();
  });

  it("A/B 逆序完成时只接受最后点击的 B", async () => {
    const controller = createLatestRequestController();
    const requestA = deferred<string>();
    const requestB = deferred<string>();
    const accepted: string[] = [];
    const tokenA = controller.begin("footnote-a");
    const completionA = requestA.promise.then((result) => {
      if (controller.isCurrent(tokenA)) accepted.push(result);
    });
    const tokenB = controller.begin("footnote-b");
    const completionB = requestB.promise.then((result) => {
      if (controller.isCurrent(tokenB)) accepted.push(result);
    });

    requestB.resolve("answer-b");
    requestA.resolve("answer-a");
    await Promise.all([completionA, completionB]);

    expect(tokenA.signal.aborted).toBe(true);
    expect(accepted).toEqual(["answer-b"]);
  });

  it("失败后重试成功时只保留重试结果", async () => {
    const controller = createLatestRequestController();
    const failedToken = controller.begin("footnote-a");
    const retryToken = controller.begin("footnote-a");
    let visibleResult: string | null = null;

    expect(controller.isCurrent(failedToken)).toBe(false);
    await Promise.resolve("retry-answer").then((result) => {
      if (controller.isCurrent(retryToken)) visibleResult = result;
    });

    expect(visibleResult).toBe("retry-answer");
  });
});

describe("mergeConversationTurn", () => {
  it("拒绝其他 Conversation 的迟到响应", () => {
    const conversation = conversationFixture();

    expect(mergeConversationTurn(conversation, "conversation-b", turnFixture("turn-b"))).toBe(conversation);
  });

  it("按 turnId 去重，并以当前活动脚注替换同选区旧脚注", () => {
    const conversation = conversationFixture();
    const turn = turnFixture("turn-a");
    const first = mergeConversationTurn(conversation, conversation.conversationId, turn)!;
    const second = mergeConversationTurn(first, conversation.conversationId, turn)!;

    expect(second.turns.map((item) => item.turnId)).toEqual(["turn-a"]);
    expect(second.footnotes.map((item) => item.footnoteId)).toEqual(["footnote-new"]);
  });

  it("过期响应不会覆盖同选区更新的活动脚注", () => {
    const conversation = conversationFixture();
    conversation.updatedAt = "2026-09-30T00:02:00.000Z";
    conversation.footnotes[0]!.updatedAt = "2026-09-30T00:02:00.000Z";
    const staleTurn = turnFixture("turn-stale");

    const updated = mergeConversationTurn(conversation, conversation.conversationId, staleTurn)!;

    expect(updated.turns.map((item) => item.turnId)).toEqual(["turn-stale"]);
    expect(updated.footnotes.map((item) => item.footnoteId)).toEqual(["footnote-old"]);
    expect(updated.updatedAt).toBe("2026-09-30T00:02:00.000Z");
  });
});

describe("synchronous conversation guard", () => {
  it("状态渲染前的连续双击只允许一次请求", async () => {
    const guard = createSynchronousRequestGuard();
    const request = deferred<void>();
    let callCount = 0;
    const submit = () => {
      if (!guard.tryAcquire()) return;
      callCount += 1;
      void request.promise.finally(() => guard.release());
    };

    submit();
    submit();
    expect(callCount).toBe(1);

    request.resolve();
    await request.promise;
    await Promise.resolve();
    submit();
    expect(callCount).toBe(2);
  });
});

function conversationFixture(): ReadingConversation {
  return {
    conversationId: "conversation-a",
    sceneId: "technical_learning",
    documentId: "document-1",
    revisionId: "revision-1",
    title: "技术学习",
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    turns: [],
    footnotes: [{
      footnoteId: "footnote-old",
      conversationId: "conversation-a",
      turnId: "turn-old",
      capabilityId: "selection.technical-explanation.v1",
      documentId: "document-1",
      revisionId: "revision-1",
      selectionFingerprint: "selection-1",
      selectedText: "selection",
      start: { blockId: "block-1", offset: 0 },
      end: { blockId: "block-1", offset: 9 },
      status: "active",
      createdAt: "2026-09-30T00:00:00.000Z",
      updatedAt: "2026-09-30T00:00:00.000Z",
    }],
  };
}

function turnFixture(turnId: string): ConversationTurn {
  return {
    turnId,
    question: "",
    intent: "explain",
    capabilityId: "selection.technical-explanation.v1",
    footnoteEligible: true,
    references: [],
    answer: {
      answerId: `answer-${turnId}`,
      operationId: `operation-${turnId}`,
      content: "answer",
      citationReferenceIds: [],
      outcome: "answered",
      knowledgeBoundary: "model_knowledge",
      createdAt: "2026-09-30T00:01:00.000Z",
    },
    footnote: {
      ...conversationFixture().footnotes[0]!,
      footnoteId: "footnote-new",
      turnId,
      createdAt: "2026-09-30T00:01:00.000Z",
      updatedAt: "2026-09-30T00:01:00.000Z",
    },
    createdAt: "2026-09-30T00:01:00.000Z",
  };
}
