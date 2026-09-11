import { describe, expect, it } from "vitest";
import type { AgentDebugTraceSummary } from "@lumen/api-contract";

import { agentTraceTaskLabel, filterAgentTraces } from "./agent-trace-filter";

function trace(taskType: string): AgentDebugTraceSummary {
  return {
    traceId: taskType,
    operationId: "operation-1",
    invocationId: "invocation-1",
    taskType,
    taskVersion: `${taskType}.v1`,
    status: "succeeded",
    providerId: "openai-compatible",
    modelId: "test-model",
    inputPreview: taskType,
    latencyMs: 10,
    errorMessage: null,
    createdAt: "2026-09-11T00:00:00.000Z",
    completedAt: "2026-09-11T00:00:00.010Z",
  };
}

describe("Agent Trace 筛选", () => {
  const traces = [
    trace("selection.translation"),
    trace("workspace.answer"),
    trace("workspace.query-rewrite"),
    trace("recall.evaluation"),
    trace("lexical.localization"),
  ];

  it("默认保留全部正式 Runtime Trace", () => {
    expect(filterAgentTraces(traces, "all")).toEqual(traces);
  });

  it("能独立筛选每次翻译调用", () => {
    expect(filterAgentTraces(traces, "translation").map((item) => item.taskType))
      .toEqual(["selection.translation"]);
    expect(agentTraceTaskLabel("selection.translation")).toBe("翻译");
  });

  it("Workspace 筛选同时包含检索改写与回答", () => {
    expect(filterAgentTraces(traces, "workspace").map((item) => item.taskType))
      .toEqual(["workspace.answer", "workspace.query-rewrite"]);
  });
});
