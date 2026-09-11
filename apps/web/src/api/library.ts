import {
  applicationErrorSchema,
  documentListResponseSchema,
  importDocumentResponseSchema,
  importMarkdownFolderResponseSchema,
  type DocumentSummary,
  type ImportDocumentResponse,
  type ImportMarkdownFolderResponse,
} from "@lumen/api-contract";

import type { FetchLike } from "./health";

async function errorFromResponse(response: Response): Promise<Error> {
  const result = applicationErrorSchema.safeParse(await response.json().catch(() => null));
  if (result.success) {
    return new Error(result.data.message);
  }
  return new Error(`Local Service 请求失败：HTTP ${response.status}`);
}

export async function importMarkdownFolder(
  folderName: string,
  files: Array<{ file: File; relativePath: string }>,
  fetcher: FetchLike = fetch,
): Promise<ImportMarkdownFolderResponse> {
  const body = new FormData();
  body.append("manifest", JSON.stringify({
    folderName,
    paths: files.map((entry) => entry.relativePath),
  }));
  for (const entry of files) {
    body.append("files", entry.file, entry.file.name);
  }
  const response = await fetcher("/api/folder-imports", {
    method: "POST",
    headers: { accept: "application/json" },
    body,
  });
  if (!response.ok) throw await errorFromResponse(response);
  return importMarkdownFolderResponseSchema.parse(await response.json());
}

export async function getDocuments(fetcher: FetchLike = fetch): Promise<DocumentSummary[]> {
  const response = await fetcher("/api/documents", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return documentListResponseSchema.parse(await response.json()).documents;
}

export async function importMarkdown(
  file: File,
  fetcher: FetchLike = fetch,
): Promise<ImportDocumentResponse> {
  const response = await fetcher("/api/imports", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/octet-stream",
      "x-lumen-filename": encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return importDocumentResponseSchema.parse(await response.json());
}
