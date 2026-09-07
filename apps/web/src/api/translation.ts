import {
  applicationErrorSchema,
  providerStatusSchema,
  translationResultSchema,
  type ProviderStatus,
  type TranslateSelectionRequest,
  type TranslationResult,
} from "@lumen/api-contract";

import type { FetchLike } from "./health";

async function responseError(response: Response): Promise<Error> {
  const parsed = applicationErrorSchema.safeParse(await response.json().catch(() => null));
  return new Error(parsed.success ? parsed.data.message : `翻译请求失败：HTTP ${response.status}`);
}

export async function getProviderStatus(fetcher: FetchLike = fetch): Promise<ProviderStatus> {
  const response = await fetcher("/api/settings/provider-status", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await responseError(response);
  return providerStatusSchema.parse(await response.json());
}

export async function translateSelection(
  documentId: string,
  input: TranslateSelectionRequest,
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
): Promise<TranslationResult> {
  const init: RequestInit = {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input),
  };
  if (signal !== undefined) init.signal = signal;
  const response = await fetcher(
    `/api/reader/documents/${encodeURIComponent(documentId)}/translations`,
    init,
  );
  if (!response.ok) throw await responseError(response);
  return translationResultSchema.parse(await response.json());
}
