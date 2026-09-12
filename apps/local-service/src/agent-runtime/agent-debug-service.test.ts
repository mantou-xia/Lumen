import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, type LumenDatabase } from "../infrastructure/database/database.js";
import { AgentDebugService } from "./agent-debug-service.js";

let database: LumenDatabase | null = null;
afterEach(() => { database?.close(); database = null; });

describe("AgentDebugService", () => {
  it("持久化正式 Runtime 入参、真实 Prompt、Provider 响应和关联标识", () => {
    database = openDatabase(":memory:");
    const service = new AgentDebugService(database.connection, () => "trace-1", () => "2026-09-11T00:00:00.000Z");
    const traceId = service.start({
      operationId: "operation-1",
      invocationId: "invocation-1",
      taskType: "workspace.answer",
      taskVersion: "workspace.answer.v2",
      promptVersion: "workspace.answer.prompt.v4",
      contextPolicy: "current-revision-strict-document",
      providerId: "openai-compatible",
      modelId: "debug-model",
      systemPrompt: "真实系统提示词",
      userPrompt: "真实用户提示词",
      contextSnapshot: "完整上下文快照",
      rawInput: { question: "为什么？", references: [{ label: "原句", content: "quoted", sourceRole: "explicit" }] },
      actualRequest: { headers: { authorization: "[REDACTED]" }, body: { model: "debug-model" } },
      attempt: 1,
    });
    service.complete({
      traceId,
      result: { content: "{\"content\":\"回答\"}", reasoning: "provider reasoning", rawResponse: { id: "response-1" }, inputTokens: 12, outputTokens: 4, finishReason: "stop" },
      validatedOutput: { content: "回答" },
      latencyMs: 25,
    });

    expect(service.get(traceId)).toMatchObject({
      traceId: "trace-1",
      operationId: "operation-1",
      invocationId: "invocation-1",
      taskType: "workspace.answer",
      taskVersion: "workspace.answer.v2",
      promptVersion: "workspace.answer.prompt.v4",
      status: "succeeded",
      systemPrompt: "真实系统提示词",
      reasoning: "provider reasoning",
      rawResponse: { id: "response-1" },
      validatedOutput: { content: "回答" },
      references: [{ label: "原句", content: "quoted", source: "explicit" }],
    });
    expect(service.get(traceId).logs.map((item) => item.stage)).toEqual(["runtime.compiled", "provider.request", "runtime.validated"]);
    expect(service.list({ limit: 50 }).traces[0]).toMatchObject({ operationId: "operation-1", invocationId: "invocation-1", inputPreview: "为什么？" });
  });

  it("保留正式调用的异常堆栈和失败阶段", () => {
    database = openDatabase(":memory:");
    const service = new AgentDebugService(database.connection, () => "trace-error", () => "2026-09-11T00:00:00.000Z");
    const traceId = service.start({ operationId: "operation-error", invocationId: "invocation-error", taskType: "workspace.answer", taskVersion: "workspace.answer.v2", promptVersion: "workspace.answer.prompt.v4", contextPolicy: "current-revision-strict-document", providerId: "openai-compatible", modelId: "debug-model", systemPrompt: "system", userPrompt: "user", contextSnapshot: "context", rawInput: { references: [] }, actualRequest: {}, attempt: 1 });
    const error = Object.assign(new Error("结构校验失败"), { code: "MODEL_OUTPUT_INVALID", retryable: false });
    service.fail({ traceId, error, latencyMs: 8, cancelled: false });

    expect(service.get(traceId)).toMatchObject({ status: "failed", errorName: "Error", errorMessage: "结构校验失败", latencyMs: 8 });
    expect(service.get(traceId).errorStack).toContain("结构校验失败");
    expect(service.get(traceId).logs.at(-1)?.stage).toBe("runtime.failed");
  });

  it("通过稳定游标读取全部历史且不重复记录", () => {
    database = openDatabase(":memory:");
    const ids = ["trace-3", "trace-2", "trace-1"];
    const service = new AgentDebugService(database.connection, () => ids.shift()!, () => "2026-09-12T00:00:00.000Z");
    for (const invocationId of ["invocation-3", "invocation-2", "invocation-1"]) {
      service.start({ operationId: invocationId, invocationId, taskType: "workspace.answer", taskVersion: "v1", promptVersion: "p1", contextPolicy: "document", providerId: "test", modelId: "test", systemPrompt: "system", userPrompt: "user", contextSnapshot: "context", rawInput: {}, actualRequest: {}, attempt: 1 });
    }
    const first = service.list({ limit: 2 });
    const second = service.list({ limit: 2, cursor: first.nextCursor! });
    expect(first.traces.map((trace) => trace.traceId)).toEqual(["trace-3", "trace-2"]);
    expect(second.traces.map((trace) => trace.traceId)).toEqual(["trace-1"]);
    expect(second.nextCursor).toBeNull();
  });
});
