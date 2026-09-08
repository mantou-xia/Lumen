import {
  applicationErrorSchema,
  providerStatusSchema,
  translationRangeListSchema,
  translationResultSchema,
  type ProviderStatus,
  type TranslateSelectionRequest,
  type TranslationRangeSummary,
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

export async function getTranslationRanges(
  documentId: string,
  revisionId: string,
  blockIds: string[],
  fetcher: FetchLike = fetch,
): Promise<TranslationRangeSummary[]> {
  const response = await fetcher(
    `/api/reader/documents/${encodeURIComponent(documentId)}/translation-ranges`,
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ revisionId, blockIds }),
    },
  );
  if (!response.ok) throw await responseError(response);
  return translationRangeListSchema.parse(await response.json()).ranges;
}

export async function getTranslationResult(
  translationId: string,
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
): Promise<TranslationResult> {
  const init: RequestInit = { headers: { accept: "application/json" } };
  if (signal !== undefined) init.signal = signal;
  const response = await fetcher(`/api/translations/${encodeURIComponent(translationId)}`, init);
  if (!response.ok) throw await responseError(response);
  return translationResultSchema.parse(await response.json());
}

export async function retryTranslation(
  translationId: string,
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
): Promise<TranslationResult> {
  const init: RequestInit = {
    method: "POST",
    headers: { accept: "application/json" },
  };
  if (signal !== undefined) init.signal = signal;
  const response = await fetcher(
    `/api/translations/${encodeURIComponent(translationId)}/retry`,
    init,
  );
  if (!response.ok) throw await responseError(response);
  return translationResultSchema.parse(await response.json());
}
