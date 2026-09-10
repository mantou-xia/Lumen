import {
  applicationErrorSchema,
  workspaceSessionSchema,
  workspaceSessionListSchema,
  workspaceTurnSchema,
  type CreateWorkspaceTurnRequest,
  type WorkspaceSession,
  type WorkspaceSessionSummary,
  type WorkspaceTurn,
} from "@lumen/api-contract";

import type { FetchLike } from "./health";

async function responseError(response: Response): Promise<Error> {
  const parsed = applicationErrorSchema.safeParse(await response.json().catch(() => null));
  return new Error(parsed.success ? parsed.data.message : `Workspace 请求失败：HTTP ${response.status}`);
}

export async function openWorkspace(
  documentId: string,
  revisionId: string,
  fetcher: FetchLike = fetch,
  createNew = false,
): Promise<WorkspaceSession> {
  const response = await fetcher(
    `/api/reader/documents/${encodeURIComponent(documentId)}/workspace`,
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ revisionId, createNew }),
    },
  );
  if (!response.ok) throw await responseError(response);
  return workspaceSessionSchema.parse(await response.json());
}

export function createWorkspace(
  documentId: string,
  revisionId: string,
  fetcher: FetchLike = fetch,
): Promise<WorkspaceSession> {
  return openWorkspace(documentId, revisionId, fetcher, true);
}

export async function listWorkspaces(
  documentId: string,
  revisionId: string,
  fetcher: FetchLike = fetch,
): Promise<WorkspaceSessionSummary[]> {
  const params = new URLSearchParams({ revisionId });
  const response = await fetcher(
    `/api/reader/documents/${encodeURIComponent(documentId)}/workspaces?${params.toString()}`,
    { headers: { accept: "application/json" } },
  );
  if (!response.ok) throw await responseError(response);
  return workspaceSessionListSchema.parse(await response.json());
}

export async function getWorkspace(
  sessionId: string,
  fetcher: FetchLike = fetch,
): Promise<WorkspaceSession> {
  const response = await fetcher(`/api/workspaces/${encodeURIComponent(sessionId)}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await responseError(response);
  return workspaceSessionSchema.parse(await response.json());
}

export async function askWorkspace(
  sessionId: string,
  input: CreateWorkspaceTurnRequest,
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
): Promise<WorkspaceTurn> {
  const response = await fetcher(`/api/workspaces/${encodeURIComponent(sessionId)}/turns`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw await responseError(response);
  return workspaceTurnSchema.parse(await response.json());
}
