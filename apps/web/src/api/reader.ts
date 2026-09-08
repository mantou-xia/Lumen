import {
  applicationErrorSchema,
  readerDocumentSchema,
  readingProgressSchema,
  type ReaderDocument,
  type ReadingProgress,
  type UpdateReadingProgressRequest,
} from "@lumen/api-contract";

import type { FetchLike } from "./health";

async function responseError(response: Response): Promise<Error> {
  const parsed = applicationErrorSchema.safeParse(await response.json().catch(() => null));
  return new Error(
    parsed.success ? parsed.data.message : `Reader 请求失败：HTTP ${response.status}`,
  );
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
