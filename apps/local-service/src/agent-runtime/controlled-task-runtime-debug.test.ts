import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClockPort, IdGeneratorPort, RuntimeRepositoryPort } from "../application/ports.js";
import { openDatabase, type LumenDatabase } from "../infrastructure/database/database.js";
import { AgentDebugService } from "./agent-debug-service.js";
import { ControlledTaskRuntime } from "./controlled-task-runtime.js";
import type { ModelProvider } from "./model-provider.js";

let database: LumenDatabase | null = null;
afterEach(() => { database?.close(); database = null; });

describe("ControlledTaskRuntime Agent Debug", () => {
  it("从正式 Workspace invocation 捕获真实提示词、引用和校验后输出", async () => {
    database = openDatabase(":memory:");
    const repository = {
      recordTaskCompiled: vi.fn(),
      startInvocation: vi.fn(),
      completeInvocation: vi.fn(),
      failInvocation: vi.fn(),
      cancelInvocation: vi.fn(),
    } as unknown as RuntimeRepositoryPort;
    const ids: IdGeneratorPort = { generate: () => "invocation-1" };
    const clock: ClockPort = { now: () => "2026-09-11T00:00:00.000Z" };
    const provider: ModelProvider = {
      providerId: "openai-compatible",
      modelId: "test-model",
      configured: true,
      baseUrl: "http://provider.test/v1",
      describeInvocation: (request) => ({ endpoint: "http://provider.test/v1/chat/completions", headers: { authorization: "[REDACTED]" }, messages: [{ role: "system", content: request.systemPrompt }, { role: "user", content: request.userPrompt }] }),
      invoke: async () => ({ content: JSON.stringify({ content: "根据原句可知。", citationReferenceIds: ["reference-1"], outcome: "answered" }), reasoning: "provider reasoning", rawResponse: { id: "response-1" }, inputTokens: 20, outputTokens: 10, finishReason: "stop" }),
    };
    const debug = new AgentDebugService(database.connection, () => "trace-1", () => "2026-09-11T00:00:00.000Z");
    const runtime = new ControlledTaskRuntime(provider, repository, ids, clock, undefined, debug);

    await runtime.executeWorkspace({
      operationId: "operation-1",
      question: "这句话是什么意思？",
      contextMode: "explicit_references_only",
      references: [{ referenceId: "reference-1", type: "selection", targetId: null, label: "原句", content: "What is essential is invisible to the eye.", documentId: "document-1", revisionId: "revision-1", start: null, end: null, sourceRole: "explicit" }],
    });

    const trace = debug.get("trace-1");
    expect(trace.systemPrompt).toContain("Lumen 的受控阅读上下文助手");
    expect(trace.userPrompt).toContain("What is essential is invisible to the eye.");
    expect(trace).toMatchObject({ operationId: "operation-1", invocationId: "invocation-1", taskType: "workspace.answer", taskVersion: "workspace.answer.v2", status: "succeeded", reasoning: "provider reasoning" });
    expect(trace.references).toEqual([{ label: "原句", content: "What is essential is invisible to the eye.", source: "explicit" }]);
    expect(repository.completeInvocation).toHaveBeenCalledOnce();
  });
});
