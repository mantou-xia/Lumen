import {
  applicationErrorSchema,
  lexicalProfileResponseSchema,
  type LexicalProfileResponse,
} from "@lumen/api-contract";

import type { FetchLike } from "./health";

async function responseError(response: Response): Promise<Error> {
  const parsed = applicationErrorSchema.safeParse(await response.json().catch(() => null));
  return new Error(parsed.success ? parsed.data.message : `词汇资料请求失败：HTTP ${response.status}`);
}

async function requestLexicalProfile(
  translationId: string,
  method: "GET" | "POST",
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
): Promise<LexicalProfileResponse> {
  const init: RequestInit = {
    method,
    headers: { accept: "application/json" },
  };
  if (signal !== undefined) init.signal = signal;
  const suffix = method === "POST" ? "/refresh" : "";
  const response = await fetcher(
    `/api/translations/${encodeURIComponent(translationId)}/lexical-profile${suffix}`,
    init,
  );
  if (!response.ok) throw await responseError(response);
  return lexicalProfileResponseSchema.parse(await response.json());
}

export function getLexicalProfile(
  translationId: string,
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
): Promise<LexicalProfileResponse> {
  return requestLexicalProfile(translationId, "GET", signal, fetcher);
}

export function refreshLexicalProfile(
  translationId: string,
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
): Promise<LexicalProfileResponse> {
  return requestLexicalProfile(translationId, "POST", signal, fetcher);
}
