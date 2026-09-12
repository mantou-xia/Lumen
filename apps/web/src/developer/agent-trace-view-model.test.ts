import { describe, expect, it } from "vitest";
import type {
  AgentDebugTrace,
  AgentDebugTraceSummary,
  DailyReadingWorkflowTrace,
  DailyReadingWorkflowTraceSummary,
} from "@lumen/api-contract";

import {
  buildExecutionList,
  buildWorkflowSteps,
  diagnoseAgentTrace,
  diagnoseWorkflow,
  filterExecutionList,
} from "./agent-trace-view-model";

function summary(overrides: Partial<AgentDebugTraceSummary> = {}): AgentDebugTraceSummary {
  return {
    traceId: "trace-1",
    operationId: "operation-1",
    invocationId: "invocation-1",
    taskType: "workspace.answer",
    taskVersion: "workspace.answer.v1",
    status: "succeeded",
    providerId: "openai-compatible",
    modelId: "test-model",
    inputPreview: "为什么这里使用这个表达？",
    latencyMs: 100,
    errorMessage: null,
    createdAt: "2026-09-12T01:00:00.000Z",
    completedAt: "2026-09-12T01:00:00.100Z",
    ...overrides,
  };
}

function workflowSummary(overrides: Partial<DailyReadingWorkflowTraceSummary> = {}): DailyReadingWorkflowTraceSummary {
  return {
    runId: "run-1",
    automationId: "automation-1",
    bookId: "book-1",
    bookTitle: "AI Daily",
    operationId: "operation-daily",
    status: "completed",
    triggerReason: "scheduled",
    localDate: "2026-09-12",
    source: null,
    eventCount: 3,
    createdAt: "2026-09-12T02:00:00.000Z",
    completedAt: "2026-09-12T02:00:01.000Z",
    ...overrides,
  };
}

function fullTrace(overrides: Partial<AgentDebugTrace> = {}): AgentDebugTrace {
  return {
    ...summary(),
    promptVersion: "prompt.v1",
    contextPolicy: "document",
    systemPrompt: "system",
    userPrompt: "user",
    context: "context",
    references: [],
    metadata: {},
    actualRequest: {},
    rawResponse: null,
    output: null,
    validatedOutput: null,
    reasoning: null,
    inputTokens: null,
    outputTokens: null,
    finishReason: null,
    errorName: null,
    errorStack: null,
    errorCause: null,
    logs: [],
    ...overrides,
  };
}

function fullWorkflow(overrides: Partial<DailyReadingWorkflowTrace> = {}): DailyReadingWorkflowTrace {
  return {
    ...workflowSummary(),
    interestDescription: "关注 AI 和具身智能前沿",
    events: [],
    ...overrides,
  };
}

describe("Agent Test 执行视图模型", () => {
  it("按 operation 聚合普通 Invocation，并避免重复列出 Workflow 关联调用", () => {
    const traces = [
      summary({ traceId: "rewrite", taskType: "workspace.query-rewrite" }),
      summary({ traceId: "answer", invocationId: "invocation-2", createdAt: "2026-09-12T01:00:01.000Z" }),
      summary({ traceId: "daily", operationId: "operation-daily", taskType: "daily-reading.interest-profile" }),
    ];
    const items = buildExecutionList(traces, [workflowSummary()]);

    expect(items).toHaveLength(2);
    expect(items.find((item) => item.kind === "agent-operation")?.traceIds).toEqual(["rewrite", "answer"]);
    expect(items.find((item) => item.kind === "daily-reading-workflow")?.traceIds).toEqual(["daily"]);
  });

  it("失败 Invocation 会让整个 operation 标记为失败并可按状态和关键词筛选", () => {
    const items = buildExecutionList([
      summary(),
      summary({ traceId: "trace-2", status: "failed", errorMessage: "schema invalid" }),
    ], []);

    expect(items[0]?.status).toBe("failed");
    expect(filterExecutionList(items, "workspace", "failed", "为什么")).toHaveLength(1);
  });

  it("从错误日志定位 Agent 的具体失败阶段", () => {
    const diagnosis = diagnoseAgentTrace(fullTrace({
      status: "failed",
      errorName: "ModelOutputInvalidError",
      errorMessage: "schema invalid",
      logs: [{
        sequence: 1,
        level: "error",
        stage: "response.validation",
        message: "结构化输出校验失败",
        data: null,
        createdAt: "2026-09-12T01:00:01.000Z",
      }],
    }));

    expect(diagnosis.title).toContain("response.validation");
    expect(diagnosis.suggestions[0]).toContain("Schema");
  });

  it("将无合格内容识别为可排查的业务告警而不是系统异常", () => {
    const trace = fullWorkflow({
      status: "no_content",
      events: [{
        runId: "run-1",
        sequence: 1,
        stage: "run.no_content",
        level: "warning",
        message: "没有候选文章通过篇幅限制",
        data: { rejected: 4 },
        createdAt: "2026-09-12T02:00:01.000Z",
      }],
    });

    expect(diagnoseWorkflow(trace).tone).toBe("warning");
    expect(diagnoseWorkflow(trace).title).toContain("没有找到合格内容");
  });

  it("将 Workflow 事件与 Agent Invocation 合并为按时间排序的步骤账本", () => {
    const trace = fullWorkflow({
      events: [
        { runId: "run-1", sequence: 1, stage: "run.started", level: "info", message: "开始", data: {}, createdAt: "2026-09-12T02:00:00.000Z" },
        { runId: "run-1", sequence: 2, stage: "interest.completed", level: "info", message: "完成", data: {}, createdAt: "2026-09-12T02:00:02.000Z" },
      ],
    });
    const steps = buildWorkflowSteps(trace, [summary({
      traceId: "interest",
      operationId: "operation-daily",
      taskType: "daily-reading.interest-profile",
      createdAt: "2026-09-12T02:00:01.000Z",
    })]);

    expect(steps.map((step) => step.kind)).toEqual(["workflow-event", "agent-invocation", "workflow-event"]);
  });
});
