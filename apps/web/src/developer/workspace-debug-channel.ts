import type { WorkspaceSession, WorkspaceSessionSummary } from "@lumen/api-contract";
import type { PendingWorkspaceReference } from "../reader/WorkspacePanel";

export const workspaceDebugChannelName = "lumen.workspace-debug.v1";

export interface WorkspaceDebugSnapshot {
  type: "snapshot";
  question: string;
  pendingReferences: PendingWorkspaceReference[];
  sessions: WorkspaceSessionSummary[];
  session: WorkspaceSession | null;
  status: "idle" | "opening" | "asking" | "error";
  error: string | null;
  canReferenceDocument: boolean;
  referenceMode: boolean;
  referenceTargetKind: "word" | "phrase" | "sentence" | "block" | null;
  updatedAt: string;
}

export type WorkspaceDebugCommand =
  | { type: "request_snapshot" }
  | { type: "set_question"; question: string }
  | { type: "submit" }
  | { type: "create_session" }
  | { type: "switch_session"; sessionId: string }
  | { type: "toggle_reference_mode" }
  | { type: "remove_reference"; key: string };

export function openWorkspaceDebugChannel(): BroadcastChannel | null {
  if (import.meta.env.VITE_AGENT_TEST !== "true" || !("BroadcastChannel" in window)) return null;
  return new BroadcastChannel(workspaceDebugChannelName);
}

export function isWorkspaceDebugCommand(value: unknown): value is WorkspaceDebugCommand {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  return ["request_snapshot", "set_question", "submit", "create_session", "switch_session", "toggle_reference_mode", "remove_reference"]
    .includes(String((value as { type: unknown }).type));
}
