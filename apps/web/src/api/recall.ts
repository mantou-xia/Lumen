import {
  applicationErrorSchema,
  recallEvaluationSchema,
  recallMatchListSchema,
  recallOccurrenceSchema,
  type RecallEvaluation,
  type RecallMatch,
  type RecallOccurrence,
} from "@lumen/api-contract";

import type { FetchLike } from "./health";

async function responseError(response: Response): Promise<Error> {
  const parsed = applicationErrorSchema.safeParse(await response.json().catch(() => null));
  return new Error(parsed.success ? parsed.data.message : `Recall 请求失败：HTTP ${response.status}`);
}

export async function getRecallMatches(
  documentId: string,
  revisionId: string,
  blockIds: string[],
  fetcher: FetchLike = fetch,
): Promise<RecallMatch[]> {
  const response = await fetcher(
    `/api/reader/documents/${encodeURIComponent(documentId)}/recall-matches`,
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ revisionId, blockIds }),
    },
  );
  if (!response.ok) throw await responseError(response);
  return recallMatchListSchema.parse(await response.json()).matches;
}

export async function openRecallOccurrence(
  revisionId: string,
  match: RecallMatch,
  fetcher: FetchLike = fetch,
): Promise<RecallOccurrence> {
  const response = await fetcher("/api/recall-occurrences", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ revisionId, match }),
  });
  if (!response.ok) throw await responseError(response);
  return recallOccurrenceSchema.parse(await response.json());
}

export async function evaluateRecall(
  occurrenceId: string,
  userInterpretation: string,
  fetcher: FetchLike = fetch,
): Promise<RecallEvaluation> {
  const response = await fetcher(
    `/api/recall-occurrences/${encodeURIComponent(occurrenceId)}/evaluation`,
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ userInterpretation }),
    },
  );
  if (!response.ok) throw await responseError(response);
  return recallEvaluationSchema.parse(await response.json());
}
