import {
  agentDebugTraceListSchema,
  agentDebugTraceSchema,
  dailyReadingWorkflowTraceListSchema,
  dailyReadingWorkflowTraceSchema,
  type AgentDebugTrace,
  type AgentDebugTraceSummary,
  type DailyReadingWorkflowTrace,
  type DailyReadingWorkflowTraceSummary,
} from "@lumen/api-contract";

async function checked(response: Response): Promise<unknown> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Agent Debug 请求失败：HTTP ${response.status}`);
  return payload;
}

export async function listAgentTraces(): Promise<AgentDebugTraceSummary[]> {
  const parsed = agentDebugTraceListSchema.parse(await checked(await fetch("/api/dev/agent-traces")));
  return parsed.traces;
}

export async function getAgentTrace(traceId: string): Promise<AgentDebugTrace> {
  return agentDebugTraceSchema.parse(await checked(await fetch(`/api/dev/agent-traces/${traceId}`)));
}

export async function listDailyReadingWorkflowTraces(): Promise<DailyReadingWorkflowTraceSummary[]> {
  const parsed = dailyReadingWorkflowTraceListSchema.parse(
    await checked(await fetch("/api/dev/daily-reading-workflows")),
  );
  return parsed.traces;
}

export async function getDailyReadingWorkflowTrace(runId: string): Promise<DailyReadingWorkflowTrace> {
  return dailyReadingWorkflowTraceSchema.parse(
    await checked(await fetch(`/api/dev/daily-reading-workflows/${runId}`)),
  );
}
