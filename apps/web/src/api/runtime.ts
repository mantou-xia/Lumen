import {
  applicationErrorSchema,
  operationEventListSchema,
  operationEventSchema,
  operationSchema,
  type Operation,
  type OperationEvent,
} from "@lumen/api-contract";

import type { FetchLike } from "./health";

async function responseError(response: Response): Promise<Error> {
  const parsed = applicationErrorSchema.safeParse(await response.json().catch(() => null));
  return new Error(parsed.success ? parsed.data.message : `Operation 请求失败：HTTP ${response.status}`);
}

export async function getOperation(
  operationId: string,
  fetcher: FetchLike = fetch,
): Promise<Operation> {
  const response = await fetcher(`/api/operations/${encodeURIComponent(operationId)}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await responseError(response);
  return operationSchema.parse(await response.json());
}

export async function getOperationEvents(
  operationId: string,
  after = 0,
  fetcher: FetchLike = fetch,
): Promise<OperationEvent[]> {
  const response = await fetcher(
    `/api/operations/${encodeURIComponent(operationId)}/events?after=${after}`,
    { headers: { accept: "application/json" } },
  );
  if (!response.ok) throw await responseError(response);
  return operationEventListSchema.parse(await response.json()).events;
}

export async function cancelOperation(
  operationId: string,
  fetcher: FetchLike = fetch,
): Promise<Operation> {
  const response = await fetcher(`/api/operations/${encodeURIComponent(operationId)}/cancel`, {
    method: "POST",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await responseError(response);
  return operationSchema.parse(await response.json());
}

export function subscribeOperationEvents(
  operationId: string,
  after: number,
  onEvent: (event: OperationEvent) => void,
  createSource: (url: string) => EventSource = (url) => new EventSource(url),
): () => void {
  const source = createSource(
    `/api/operations/${encodeURIComponent(operationId)}/events/stream?after=${after}`,
  );
  source.onmessage = (message) => {
    const parsed = operationEventSchema.safeParse(JSON.parse(message.data) as unknown);
    if (parsed.success) onEvent(parsed.data);
  };
  return () => source.close();
}
