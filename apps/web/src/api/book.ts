import {
  applicationErrorSchema,
  bookDetailSchema,
  bookListResponseSchema,
  bookReadingProgressSchema,
  readerBookSchema,
  type BookDetail,
  type BookReadingProgress,
  type BookSummary,
  type CreateBookRequest,
  type ReaderBook,
  type ReorderBookPagesRequest,
  type UpdateBookReadingProgressRequest,
} from "@lumen/api-contract";

import type { FetchLike } from "./health";

async function responseError(response: Response): Promise<Error> {
  const parsed = applicationErrorSchema.safeParse(await response.json().catch(() => null));
  return new Error(parsed.success ? parsed.data.message : `Book 请求失败：HTTP ${response.status}`);
}

export async function getBooks(fetcher: FetchLike = fetch): Promise<BookSummary[]> {
  const response = await fetcher("/api/books", { headers: { accept: "application/json" } });
  if (!response.ok) throw await responseError(response);
  return bookListResponseSchema.parse(await response.json()).books;
}

export async function getBook(bookId: string, fetcher: FetchLike = fetch): Promise<BookDetail> {
  const response = await fetcher(`/api/books/${encodeURIComponent(bookId)}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await responseError(response);
  return bookDetailSchema.parse(await response.json());
}

export async function createBook(
  input: CreateBookRequest,
  fetcher: FetchLike = fetch,
): Promise<BookDetail> {
  const response = await fetcher("/api/books", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await responseError(response);
  return bookDetailSchema.parse(await response.json());
}

export async function reorderBookPages(
  bookId: string,
  input: ReorderBookPagesRequest,
  fetcher: FetchLike = fetch,
): Promise<BookDetail> {
  const response = await fetcher(`/api/books/${encodeURIComponent(bookId)}/pages/order`, {
    method: "PUT",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await responseError(response);
  return bookDetailSchema.parse(await response.json());
}

export async function openReaderBook(
  bookId: string,
  pageId: string | undefined,
  fetcher: FetchLike = fetch,
): Promise<ReaderBook> {
  const query = pageId === undefined ? "" : `?pageId=${encodeURIComponent(pageId)}`;
  const response = await fetcher(`/api/reader/books/${encodeURIComponent(bookId)}${query}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await responseError(response);
  return readerBookSchema.parse(await response.json());
}

export async function saveBookReadingProgress(
  bookId: string,
  pageId: string,
  progress: UpdateBookReadingProgressRequest,
  fetcher: FetchLike = fetch,
): Promise<BookReadingProgress> {
  const response = await fetcher(
    `/api/reader/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(pageId)}/progress`,
    {
      method: "PUT",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(progress),
      keepalive: true,
    },
  );
  if (!response.ok) throw await responseError(response);
  return bookReadingProgressSchema.parse(await response.json());
}
