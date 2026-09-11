import {
  agentDebugTraceListSchema,
  agentDebugTraceSchema,
  type AgentDebugTrace,
  type AgentDebugTraceSummary,
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
