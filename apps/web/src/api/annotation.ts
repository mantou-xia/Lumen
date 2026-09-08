import {
  annotationListSchema,
  annotationSchema,
  applicationErrorSchema,
  type Annotation,
  type AnnotationSource,
  type SemanticPoint,
} from "@lumen/api-contract";

import type { FetchLike } from "./health";

async function responseError(response: Response): Promise<Error> {
  const parsed = applicationErrorSchema.safeParse(await response.json().catch(() => null));
  return new Error(parsed.success ? parsed.data.message : `标注请求失败：HTTP ${response.status}`);
}

async function parseAnnotation(response: Response): Promise<Annotation> {
  if (!response.ok) throw await responseError(response);
  return annotationSchema.parse(await response.json());
}

export async function createAnnotation(
  documentId: string,
  revisionId: string,
  selection: { start: SemanticPoint; end: SemanticPoint; selectedText: string },
  source: AnnotationSource,
  fetcher: FetchLike = fetch,
): Promise<Annotation> {
  return parseAnnotation(await fetcher(
    `/api/reader/documents/${encodeURIComponent(documentId)}/annotations`,
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ revisionId, ...selection, note: "", source }),
    },
  ));
}

export async function getAnnotations(
  documentId: string,
  revisionId: string,
  blockIds: string[],
  fetcher: FetchLike = fetch,
): Promise<Annotation[]> {
  const response = await fetcher(
    `/api/reader/documents/${encodeURIComponent(documentId)}/annotations/query`,
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ revisionId, blockIds }),
    },
  );
  if (!response.ok) throw await responseError(response);
  return annotationListSchema.parse(await response.json()).annotations;
}

export async function updateAnnotation(
  annotationId: string,
  note: string,
  fetcher: FetchLike = fetch,
): Promise<Annotation> {
  return parseAnnotation(await fetcher(`/api/annotations/${encodeURIComponent(annotationId)}`, {
    method: "PATCH",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ note }),
  }));
}

export async function archiveAnnotation(
  annotationId: string,
  fetcher: FetchLike = fetch,
): Promise<Annotation> {
  return parseAnnotation(await fetcher(
    `/api/annotations/${encodeURIComponent(annotationId)}/archive`,
    { method: "POST", headers: { accept: "application/json" } },
  ));
}
