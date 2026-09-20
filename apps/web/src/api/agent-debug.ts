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

export async function listAgentTraces(cursor?: string): Promise<{ traces: AgentDebugTraceSummary[]; nextCursor: string | null }> {
  const query = new URLSearchParams({ limit: "50" });
  if (cursor !== undefined) query.set("cursor", cursor);
  return agentDebugTraceListSchema.parse(await checked(await fetch(`/api/dev/agent-traces?${query}`)));
}

export async function getAgentTrace(traceId: string): Promise<AgentDebugTrace> {
  return agentDebugTraceSchema.parse(await checked(await fetch(`/api/dev/agent-traces/${traceId}`)));
}

export async function listDailyReadingWorkflowTraces(cursor?: string): Promise<{ traces: DailyReadingWorkflowTraceSummary[]; nextCursor: string | null }> {
  const query = new URLSearchParams({ limit: "50" });
  if (cursor !== undefined) query.set("cursor", cursor);
  return dailyReadingWorkflowTraceListSchema.parse(
    await checked(await fetch(`/api/dev/daily-reading-workflows?${query}`)),
  );
}

export async function getDailyReadingWorkflowTrace(runId: string): Promise<DailyReadingWorkflowTrace> {
  return dailyReadingWorkflowTraceSchema.parse(
    await checked(await fetch(`/api/dev/daily-reading-workflows/${runId}`)),
  );
}
