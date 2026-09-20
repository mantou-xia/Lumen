import type { AgentDebugTraceSummary } from "@lumen/api-contract";

export type AgentTraceScope = "all" | "daily-reading" | "translation" | "workspace" | "recall" | "lexical";

export const agentTraceScopes: Array<{ value: AgentTraceScope; label: string }> = [
  { value: "all", label: "全部" },
  { value: "daily-reading", label: "每日阅读" },
  { value: "translation", label: "翻译" },
  { value: "workspace", label: "Workspace" },
  { value: "recall", label: "Recall" },
  { value: "lexical", label: "词汇本地化" },
];

export function matchesAgentTraceScope(
  trace: AgentDebugTraceSummary,
  scope: AgentTraceScope,
): boolean {
  if (scope === "all") return true;
  const taskType = trace.taskType ?? "";
  if (scope === "daily-reading") return taskType.startsWith("daily-reading.");
  if (scope === "translation") return taskType.startsWith("selection.translation");
  if (scope === "workspace") return taskType.startsWith("workspace.");
  if (scope === "recall") return taskType.startsWith("recall.");
  return taskType.startsWith("lexical.");
}

export function filterAgentTraces(
  traces: AgentDebugTraceSummary[],
  scope: AgentTraceScope,
): AgentDebugTraceSummary[] {
  return traces.filter((trace) => matchesAgentTraceScope(trace, scope));
}

export function agentTraceTaskLabel(taskType: string | null): string {
  if (taskType?.startsWith("selection.translation")) return "翻译";
  if (taskType?.startsWith("daily-reading.interest-profile")) return "每日阅读兴趣解析";
  if (taskType?.startsWith("daily-reading.candidate-selection")) return "每日阅读候选选择";
  if (taskType?.startsWith("daily-reading.")) return "每日阅读";
  if (taskType?.startsWith("workspace.query-rewrite")) return "Workspace 检索改写";
  if (taskType?.startsWith("workspace.")) return "Workspace 回答";
  if (taskType?.startsWith("recall.")) return "Recall 判断";
  if (taskType?.startsWith("lexical.")) return "词汇本地化";
  return taskType ?? "未知任务";
}
