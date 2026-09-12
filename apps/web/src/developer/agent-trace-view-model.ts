import type {
  AgentDebugTrace,
  AgentDebugTraceSummary,
  DailyReadingWorkflowTrace,
  DailyReadingWorkflowTraceSummary,
} from "@lumen/api-contract";

import {
  agentTraceTaskLabel,
  matchesAgentTraceScope,
  type AgentTraceScope,
} from "./agent-trace-filter";

export type ExecutionStatus = "running" | "succeeded" | "failed" | "warning";
export type ExecutionTone = "info" | "success" | "warning" | "danger";

export type ExecutionListItem = {
  id: string;
  kind: "agent-operation" | "daily-reading-workflow";
  title: string;
  subtitle: string;
  status: ExecutionStatus;
  createdAt: string;
  completedAt: string | null;
  operationId: string | null;
  traceIds: string[];
  runId: string | null;
  scope: AgentTraceScope;
  stepCount: number;
};

export type ExecutionDiagnosis = {
  tone: ExecutionTone;
  title: string;
  summary: string;
  focus: string;
  suggestions: string[];
};

export type ExecutionStep = {
  id: string;
  kind: "workflow-event" | "agent-invocation";
  sequence: number;
  title: string;
  stage: string;
  summary: string;
  status: ExecutionStatus;
  createdAt: string;
  traceId: string | null;
  data: unknown;
};

const workflowTriggerLabels: Record<DailyReadingWorkflowTraceSummary["triggerReason"], string> = {
  initial: "首次生成",
  scheduled: "定时执行",
  startup_catchup: "启动补偿",
  manual_retry: "手动重试",
};

export function executionStatusTone(status: ExecutionStatus): ExecutionTone {
  if (status === "succeeded") return "success";
  if (status === "failed") return "danger";
  if (status === "warning") return "warning";
  return "info";
}

export function executionStatusLabel(status: ExecutionStatus): string {
  if (status === "succeeded") return "成功";
  if (status === "failed") return "失败";
  if (status === "warning") return "需关注";
  return "执行中";
}

export function buildExecutionList(
  traces: AgentDebugTraceSummary[],
  workflows: DailyReadingWorkflowTraceSummary[],
): ExecutionListItem[] {
  const workflowOperationIds = new Set(
    workflows.flatMap((workflow) => workflow.operationId === null ? [] : [workflow.operationId]),
  );
  const items: ExecutionListItem[] = workflows.map((workflow) => ({
    id: `workflow:${workflow.runId}`,
    kind: "daily-reading-workflow",
    title: `每日阅读 · ${workflow.bookTitle}`,
    subtitle: `${workflowTriggerLabels[workflow.triggerReason]} · ${workflow.localDate}`,
    status: normalizeWorkflowStatus(workflow.status),
    createdAt: workflow.createdAt,
    completedAt: workflow.completedAt,
    operationId: workflow.operationId,
    traceIds: traces
      .filter((trace) => workflow.operationId !== null && trace.operationId === workflow.operationId)
      .map((trace) => trace.traceId),
    runId: workflow.runId,
    scope: "daily-reading",
    stepCount: workflow.eventCount,
  }));

  const operationGroups = new Map<string, AgentDebugTraceSummary[]>();
  for (const trace of traces) {
    if (trace.operationId !== null && workflowOperationIds.has(trace.operationId)) continue;
    const key = trace.operationId ?? `trace:${trace.traceId}`;
    const group = operationGroups.get(key) ?? [];
    group.push(trace);
    operationGroups.set(key, group);
  }

  for (const [operationKey, group] of operationGroups) {
    group.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const first = group[0];
    const last = group[group.length - 1];
    if (first === undefined || last === undefined) continue;
    const labels = [...new Set(group.map((trace) => agentTraceTaskLabel(trace.taskType)))];
    const scope = inferScope(first.taskType);
    items.push({
      id: `operation:${operationKey}`,
      kind: "agent-operation",
      title: labels.length === 1 ? labels[0] ?? "未知任务" : `${scopeLabel(scope)}执行`,
      subtitle: first.inputPreview ?? `operation ${first.operationId ?? first.traceId.slice(0, 8)}`,
      status: mergeTraceStatuses(group),
      createdAt: first.createdAt,
      completedAt: group.every((trace) => trace.completedAt !== null) ? last.completedAt : null,
      operationId: first.operationId,
      traceIds: group.map((trace) => trace.traceId),
      runId: null,
      scope,
      stepCount: group.length,
    });
  }

  return items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function filterExecutionList(
  items: ExecutionListItem[],
  scope: AgentTraceScope,
  status: "all" | ExecutionStatus,
  query: string,
): ExecutionListItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  return items.filter((item) => {
    if (scope !== "all" && item.scope !== scope) return false;
    if (status !== "all" && item.status !== status) return false;
    if (normalizedQuery.length === 0) return true;
    return [item.title, item.subtitle, item.operationId, item.runId]
      .filter((value): value is string => value !== null)
      .some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
  });
}

export function buildOperationSteps(traces: AgentDebugTraceSummary[]): ExecutionStep[] {
  return [...traces]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((trace, index) => ({
      id: `invocation:${trace.traceId}`,
      kind: "agent-invocation",
      sequence: index + 1,
      title: agentTraceTaskLabel(trace.taskType),
      stage: trace.taskType ?? "unknown",
      summary: trace.errorMessage ?? `${trace.providerId} / ${trace.modelId}`,
      status: trace.status,
      createdAt: trace.createdAt,
      traceId: trace.traceId,
      data: trace,
    }));
}

export function buildWorkflowSteps(
  workflow: DailyReadingWorkflowTrace,
  traces: AgentDebugTraceSummary[],
): ExecutionStep[] {
  const entries: Array<ExecutionStep & { orderKey: string }> = [
    ...workflow.events.map((event) => ({
      id: `event:${event.sequence}`,
      kind: "workflow-event" as const,
      sequence: event.sequence,
      title: workflowStageLabel(event.stage),
      stage: event.stage,
      summary: event.message,
      status: event.level === "error" ? "failed" as const : event.level === "warning" ? "warning" as const : "succeeded" as const,
      createdAt: event.createdAt,
      traceId: null,
      data: event.data,
      orderKey: `${event.createdAt}:0:${String(event.sequence).padStart(4, "0")}`,
    })),
    ...traces.map((trace, index) => ({
      id: `invocation:${trace.traceId}`,
      kind: "agent-invocation" as const,
      sequence: index + 1,
      title: agentTraceTaskLabel(trace.taskType),
      stage: trace.taskType ?? "unknown",
      summary: trace.errorMessage ?? `${trace.providerId} / ${trace.modelId}`,
      status: trace.status,
      createdAt: trace.createdAt,
      traceId: trace.traceId,
      data: trace,
      orderKey: `${trace.createdAt}:1:${String(index).padStart(4, "0")}`,
    })),
  ];
  return entries
    .sort((left, right) => left.orderKey.localeCompare(right.orderKey))
    .map(({ orderKey: _orderKey, ...entry }, index) => ({ ...entry, sequence: index + 1 }));
}

export function diagnoseAgentTrace(trace: AgentDebugTrace): ExecutionDiagnosis {
  const lastLog = trace.logs.at(-1);
  const errorLog = [...trace.logs].reverse().find((log) => log.level === "error");
  if (trace.status === "running") {
    return {
      tone: "info",
      title: "任务仍在执行",
      summary: lastLog?.message ?? "Runtime 已创建 Trace，尚未写入新的阶段日志。",
      focus: lastLog?.stage ?? "runtime.pending",
      suggestions: ["等待下一条阶段日志；若长时间没有变化，检查 Provider 请求是否仍在等待。"],
    };
  }
  if (trace.status === "failed") {
    const focus = errorLog?.stage ?? lastLog?.stage ?? "runtime.failed";
    return {
      tone: "danger",
      title: `失败发生在 ${focus}`,
      summary: trace.errorMessage ?? errorLog?.message ?? "Runtime 记录了失败状态，但没有保存错误消息。",
      focus,
      suggestions: agentFailureSuggestions(trace, focus),
    };
  }
  return {
    tone: "success",
    title: "模型调用与结果处理均已完成",
    summary: trace.validatedOutput === null
      ? "Provider 已返回结果；该任务没有记录结构化校验输出。"
      : "Provider 已返回结果，且结构化输出已经通过任务校验。",
    focus: lastLog?.stage ?? "runtime.completed",
    suggestions: ["如需优化质量，优先比较任务原始输入、实际 Prompt 与结构化输出是否符合预期。"],
  };
}

export function diagnoseWorkflow(trace: DailyReadingWorkflowTrace): ExecutionDiagnosis {
  const lastEvent = trace.events.at(-1);
  const problemEvent = [...trace.events].reverse().find(
    (event) => event.level === "error" || event.level === "warning",
  );
  if (trace.status === "failed") {
    return {
      tone: "danger",
      title: `Workflow 失败在 ${problemEvent?.stage ?? lastEvent?.stage ?? "未知阶段"}`,
      summary: problemEvent?.message ?? lastEvent?.message ?? "Workflow 已失败，但没有可用的事件消息。",
      focus: problemEvent?.stage ?? lastEvent?.stage ?? "run.failed",
      suggestions: ["先检查该阶段事件数据，再检查时间上相邻的 Agent Invocation 或外部请求。"],
    };
  }
  if (trace.status === "no_content") {
    return {
      tone: "warning",
      title: "流程正常结束，但没有找到合格内容",
      summary: problemEvent?.message ?? lastEvent?.message ?? "候选材料没有通过当前筛选条件。",
      focus: problemEvent?.stage ?? "run.no_content",
      suggestions: ["检查候选拒绝事件，判断问题来自来源池、正文提取、篇幅限制还是兴趣匹配。"],
    };
  }
  if (trace.status === "interrupted") {
    return {
      tone: "warning",
      title: "上一次运行被中断",
      summary: lastEvent?.message ?? "应用退出或进程停止前，Workflow 没有写入完成状态。",
      focus: lastEvent?.stage ?? "run.interrupted",
      suggestions: ["确认启动补偿是否创建了新的运行；旧运行只用于保留中断证据。"],
    };
  }
  if (trace.status === "requested" || trace.status === "running") {
    return {
      tone: "info",
      title: "Workflow 正在执行",
      summary: lastEvent?.message ?? "运行已创建，正在等待首个阶段事件。",
      focus: lastEvent?.stage ?? "run.requested",
      suggestions: ["关注最后一个阶段以及其后是否出现对应的 Agent Invocation。"],
    };
  }
  return {
    tone: "success",
    title: "今日阅读已成功写入 Book",
    summary: lastEvent?.message ?? "Workflow 已完成全部阶段。",
    focus: lastEvent?.stage ?? "run.completed",
    suggestions: ["如需优化内容质量，重点检查兴趣解析、候选选择和最终来源三个阶段。"],
  };
}

export function preferredTraceId(traces: AgentDebugTraceSummary[]): string | null {
  return traces.find((trace) => trace.status === "failed")?.traceId
    ?? traces.find((trace) => trace.status === "running")?.traceId
    ?? traces.at(-1)?.traceId
    ?? null;
}

function mergeTraceStatuses(traces: AgentDebugTraceSummary[]): ExecutionStatus {
  if (traces.some((trace) => trace.status === "failed")) return "failed";
  if (traces.some((trace) => trace.status === "running")) return "running";
  return "succeeded";
}

function normalizeWorkflowStatus(status: DailyReadingWorkflowTraceSummary["status"]): ExecutionStatus {
  if (status === "completed") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "no_content" || status === "interrupted") return "warning";
  return "running";
}

function inferScope(taskType: string | null): AgentTraceScope {
  const scopes: AgentTraceScope[] = ["daily-reading", "translation", "workspace", "recall", "lexical"];
  return scopes.find((scope) => matchesAgentTraceScope({ taskType } as AgentDebugTraceSummary, scope)) ?? "all";
}

function scopeLabel(scope: AgentTraceScope): string {
  if (scope === "workspace") return "Workspace ";
  if (scope === "daily-reading") return "每日阅读 ";
  if (scope === "translation") return "翻译 ";
  if (scope === "recall") return "Recall ";
  if (scope === "lexical") return "词汇 ";
  return "Agent ";
}

function workflowStageLabel(stage: DailyReadingWorkflowTrace["events"][number]["stage"]): string {
  const labels: Record<typeof stage, string> = {
    "run.requested": "创建运行",
    "run.started": "开始执行",
    "interest.completed": "解析阅读兴趣",
    "sources.discovered": "发现候选来源",
    "candidates.ranked": "排序候选文章",
    "article.rejected": "拒绝候选文章",
    "article.selected": "选定阅读材料",
    "document.imported": "导入 Markdown 文档",
    "page.appended": "追加 Book Page",
    "run.completed": "完成运行",
    "run.no_content": "无合格内容",
    "run.failed": "运行失败",
    "run.interrupted": "运行中断",
  };
  return labels[stage];
}

function agentFailureSuggestions(trace: AgentDebugTrace, focus: string): string[] {
  const message = `${trace.errorName ?? ""} ${trace.errorMessage ?? ""} ${focus}`.toLocaleLowerCase("en-US");
  if (message.includes("schema") || message.includes("valid") || message.includes("parse") || message.includes("json")) {
    return ["对照“模型原始输出”和“结构化输出”，确认 Prompt 要求与 Schema 是否一致。"];
  }
  if (message.includes("provider") || message.includes("fetch") || message.includes("network") || message.includes("timeout")) {
    return ["检查 Provider 配置、网络路由、请求参数和原始响应；不要先调整业务 Prompt。"];
  }
  return ["从失败阶段的日志数据开始检查，再对照实际 Provider 请求与异常堆栈。"];
}
