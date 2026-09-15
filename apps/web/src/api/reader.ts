import {
  applicationErrorSchema,
  readerDocumentSchema,
  readingProgressSchema,
  replaceMarkdownImageResponseSchema,
  type ReaderDocument,
  type ReadingProgress,
  type ReplaceMarkdownImageResponse,
  type UpdateReadingProgressRequest,
} from "@lumen/api-contract";

import type { FetchLike } from "./health";

async function responseError(response: Response): Promise<Error> {
  const parsed = applicationErrorSchema.safeParse(await response.json().catch(() => null));
  return new Error(
    parsed.success ? parsed.data.message : `Reader 请求失败：HTTP ${response.status}`,
  );
}

export async function replaceMissingMarkdownImage(
  documentId: string,
  revisionId: string,
  resourceId: string,
  file: File,
  fetcher: FetchLike = fetch,
): Promise<ReplaceMarkdownImageResponse> {
  const response = await fetcher(
    `/api/reader/documents/${encodeURIComponent(documentId)}/revisions/${encodeURIComponent(revisionId)}/images/${encodeURIComponent(resourceId)}`,
    {
      method: "PUT",
      headers: {
        accept: "application/json",
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent(file.name),
      },
      body: file,
    },
  );
  if (!response.ok) throw await responseError(response);
  return replaceMarkdownImageResponseSchema.parse(await response.json());
}

export async function openReaderDocument(
  documentId: string,
  revisionId: string | undefined,
  fetcher: FetchLike = fetch,
): Promise<ReaderDocument> {
  const query = revisionId === undefined ? "" : `?revisionId=${encodeURIComponent(revisionId)}`;
  const response = await fetcher(`/api/reader/documents/${encodeURIComponent(documentId)}${query}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await responseError(response);
  return readerDocumentSchema.parse(await response.json());
}

export async function saveReadingProgress(
  documentId: string,
  progress: UpdateReadingProgressRequest,
  fetcher: FetchLike = fetch,
): Promise<ReadingProgress> {
  const response = await fetcher(
    `/api/reader/documents/${encodeURIComponent(documentId)}/progress`,
    {
      method: "PUT",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(progress),
      keepalive: true,
    },
  );
  if (!response.ok) throw await responseError(response);
  return readingProgressSchema.parse(await response.json());
}
