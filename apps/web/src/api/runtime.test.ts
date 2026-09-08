import { describe, expect, it, vi } from "vitest";

import {
  cancelOperation,
  getOperation,
  getOperationEvents,
  subscribeOperationEvents,
} from "./runtime";

const operation = {
  operationId: "operation-1",
  previousOperationId: null,
  taskType: "selection.translation",
  taskVersion: "selection.translation.v1",
  status: "running",
  documentId: "document-1",
  revisionId: "revision-1",
  cacheKey: null,
  latestSequence: 2,
  errorCode: null,
  errorMessage: null,
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
  completedAt: null,
  invocations: [],
};

describe("runtime API", () => {
  it("查询权威 Operation、增量事件并发起取消", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).includes("/events?")
      ? Response.json({ events: [] })
      : Response.json(operation, { status: String(input).endsWith("/cancel") ? 202 : 200 }));

    await expect(getOperation("operation-1", fetcher)).resolves.toMatchObject({ status: "running" });
    await expect(getOperationEvents("operation-1", 2, fetcher)).resolves.toEqual([]);
    await expect(cancelOperation("operation-1", fetcher)).resolves.toMatchObject({
      operationId: "operation-1",
    });
  });

  it("按 sequence 订阅并解析 SSE 数据", () => {
    const close = vi.fn();
    const source = { onmessage: null, close } as unknown as EventSource;
    const createSource = vi.fn(() => source);
    const onEvent = vi.fn();
    const unsubscribe = subscribeOperationEvents("operation-1", 2, onEvent, createSource);
    source.onmessage?.({ data: JSON.stringify({
      operationId: "operation-1",
      sequence: 3,
      eventType: "operation.completed",
      payload: {},
      createdAt: "2026-09-08T00:00:01.000Z",
    }) } as MessageEvent<string>);

    expect(createSource).toHaveBeenCalledWith(expect.stringContaining("after=2"));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ sequence: 3 }));
    unsubscribe();
    expect(close).toHaveBeenCalledOnce();
  });
});
