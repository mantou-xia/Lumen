import {
  applicationErrorSchema,
  learningExpressionDetailSchema,
  learningExpressionListSchema,
  learningItemSchema,
  type ExpressionStatus,
  type LearningContextSort,
  type LearningExpressionDetail,
  type LearningExpressionList,
  type LearningItem,
  type LearningListQuery,
} from "@lumen/api-contract";

import type { FetchLike } from "./health";

async function responseError(response: Response): Promise<Error> {
  const parsed = applicationErrorSchema.safeParse(await response.json().catch(() => null));
  return new Error(parsed.success ? parsed.data.message : `学习项请求失败：HTTP ${response.status}`);
}

async function parseDetail(response: Response): Promise<LearningExpressionDetail> {
  if (!response.ok) throw await responseError(response);
  return learningExpressionDetailSchema.parse(await response.json());
}

export async function saveLearningItem(
  translationId: string,
  fetcher: FetchLike = fetch,
): Promise<LearningItem> {
  const response = await fetcher("/api/learning-items", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ translationId }),
  });
  if (!response.ok) throw await responseError(response);
  return learningItemSchema.parse(await response.json());
}

export async function getLearningItems(
  input: Partial<LearningListQuery> = {},
  fetcher: FetchLike = fetch,
): Promise<LearningExpressionList> {
  const parameters = new URLSearchParams();
  if (input.query !== undefined && input.query.length > 0) parameters.set("query", input.query);
  if (input.expressionType !== undefined) parameters.set("expressionType", input.expressionType);
  if (input.status !== undefined) parameters.set("status", input.status);
  if (input.sourceDocumentId !== undefined) parameters.set("sourceDocumentId", input.sourceDocumentId);
  if (input.sort !== undefined) parameters.set("sort", input.sort);
  if (input.cursor !== undefined) parameters.set("cursor", input.cursor);
  if (input.limit !== undefined) parameters.set("limit", String(input.limit));
  const query = parameters.size === 0 ? "" : `?${parameters.toString()}`;
  const response = await fetcher(`/api/learning-items${query}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await responseError(response);
  return learningExpressionListSchema.parse(await response.json());
}

export async function getLearningExpression(
  expressionId: string,
  contextSort: LearningContextSort = "newest",
  fetcher: FetchLike = fetch,
): Promise<LearningExpressionDetail> {
  const response = await fetcher(
    `/api/learning-items/${encodeURIComponent(expressionId)}?contextSort=${contextSort}`,
    { headers: { accept: "application/json" } },
  );
  return parseDetail(response);
}

export async function updateLearningExpressionStatus(
  expressionId: string,
  status: ExpressionStatus,
  fetcher: FetchLike = fetch,
): Promise<LearningExpressionDetail> {
  return parseDetail(await fetcher(
    `/api/learning-items/${encodeURIComponent(expressionId)}/status`,
    jsonRequest("PATCH", { status }),
  ));
}

export async function updateLearningExpressionNote(
  expressionId: string,
  note: string,
  fetcher: FetchLike = fetch,
): Promise<LearningExpressionDetail> {
  return parseDetail(await fetcher(
    `/api/learning-items/${encodeURIComponent(expressionId)}/note`,
    jsonRequest("PATCH", { note }),
  ));
}

export async function updateLearningContextNote(
  expressionId: string,
  contextId: string,
  note: string,
  fetcher: FetchLike = fetch,
): Promise<LearningExpressionDetail> {
  return parseDetail(await fetcher(
    `/api/learning-items/${encodeURIComponent(expressionId)}/contexts/${encodeURIComponent(contextId)}/note`,
    jsonRequest("PATCH", { note }),
  ));
}

export async function archiveLearningContext(
  expressionId: string,
  contextId: string,
  fetcher: FetchLike = fetch,
): Promise<LearningExpressionDetail> {
  return parseDetail(await fetcher(
    `/api/learning-items/${encodeURIComponent(expressionId)}/contexts/${encodeURIComponent(contextId)}/archive`,
    jsonRequest("POST"),
  ));
}

function jsonRequest(method: "PATCH" | "POST", body?: unknown): RequestInit {
  const request: RequestInit = {
    method,
    headers: { accept: "application/json", "content-type": "application/json" },
  };
  if (body !== undefined) request.body = JSON.stringify(body);
  return request;
}
