import {
  applicationErrorSchema,
  createDailyReadingBookResponseSchema,
  dailyReadingAutomationSchema,
  dailyReadingRunSchema,
  type CreateDailyReadingBookRequest,
  type CreateDailyReadingBookResponse,
  type DailyReadingAutomation,
  type DailyReadingRun,
  type UpdateDailyReadingAutomationRequest,
} from "@lumen/api-contract";

import type { FetchLike } from "./health";

async function responseError(response: Response): Promise<Error> {
  const parsed = applicationErrorSchema.safeParse(await response.json().catch(() => null));
  return new Error(parsed.success ? parsed.data.message : `每日阅读请求失败：HTTP ${response.status}`);
}

export async function createDailyReadingBook(
  input: CreateDailyReadingBookRequest,
  fetcher: FetchLike = fetch,
): Promise<CreateDailyReadingBookResponse> {
  const response = await fetcher("/api/daily-reading/books", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await responseError(response);
  return createDailyReadingBookResponseSchema.parse(await response.json());
}

export async function getDailyReadingAutomation(
  bookId: string,
  fetcher: FetchLike = fetch,
): Promise<DailyReadingAutomation> {
  const response = await fetcher(`/api/books/${encodeURIComponent(bookId)}/daily-reading`);
  if (!response.ok) throw await responseError(response);
  return dailyReadingAutomationSchema.parse(await response.json());
}

export async function updateDailyReadingAutomation(
  bookId: string,
  input: UpdateDailyReadingAutomationRequest,
  fetcher: FetchLike = fetch,
): Promise<DailyReadingAutomation> {
  const response = await fetcher(`/api/books/${encodeURIComponent(bookId)}/daily-reading`, {
    method: "PATCH",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await responseError(response);
  return dailyReadingAutomationSchema.parse(await response.json());
}

export async function retryDailyReading(
  bookId: string,
  fetcher: FetchLike = fetch,
): Promise<DailyReadingRun> {
  const response = await fetcher(`/api/books/${encodeURIComponent(bookId)}/daily-reading/runs`, {
    method: "POST",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await responseError(response);
  return dailyReadingRunSchema.parse(await response.json());
}
