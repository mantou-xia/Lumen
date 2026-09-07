import {
  applicationErrorSchema,
  learningItemListSchema,
  learningItemSchema,
  type LearningItem,
} from "@lumen/api-contract";

import type { FetchLike } from "./health";

async function responseError(response: Response): Promise<Error> {
  const parsed = applicationErrorSchema.safeParse(await response.json().catch(() => null));
  return new Error(parsed.success ? parsed.data.message : `学习项请求失败：HTTP ${response.status}`);
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

export async function getLearningItems(fetcher: FetchLike = fetch): Promise<LearningItem[]> {
  const response = await fetcher("/api/learning-items", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await responseError(response);
  return learningItemListSchema.parse(await response.json()).items;
}
