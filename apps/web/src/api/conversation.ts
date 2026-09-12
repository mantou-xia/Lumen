import {
  applicationErrorSchema,
  conversationSchema,
  conversationTurnSchema,
  type CreateConversationTurnRequest,
  type ConversationTurn,
  type ReadingConversation,
} from "@lumen/api-contract";

import type { FetchLike } from "./health";

async function responseError(response: Response): Promise<Error> {
  const parsed = applicationErrorSchema.safeParse(await response.json().catch(() => null));
  return new Error(parsed.success ? parsed.data.message : `AI 对话请求失败：HTTP ${response.status}`);
}

export async function openConversation(
  documentId: string,
  revisionId: string,
  fetcher: FetchLike = fetch,
): Promise<ReadingConversation> {
  const response = await fetcher(
    `/api/reader/documents/${encodeURIComponent(documentId)}/conversation`,
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ revisionId }),
    },
  );
  if (!response.ok) throw await responseError(response);
  return conversationSchema.parse(await response.json());
}

export async function askConversation(
  conversationId: string,
  input: CreateConversationTurnRequest,
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
): Promise<ConversationTurn> {
  const response = await fetcher(`/api/conversations/${encodeURIComponent(conversationId)}/turns`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw await responseError(response);
  return conversationTurnSchema.parse(await response.json());
}
