import { healthResponseSchema, type HealthResponse } from "@lumen/api-contract";

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function getHealth(fetcher: FetchLike = fetch): Promise<HealthResponse> {
  const response = await fetcher("/api/health", {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Local Service 健康检查失败：HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("Local Service 端口返回了非 JSON 内容，可能已被其他程序占用");
  }

  return healthResponseSchema.parse(await response.json());
}

export async function waitForHealth(
  fetcher: FetchLike = fetch,
  options: { maxAttempts?: number; retryDelayMilliseconds?: number } = {},
): Promise<HealthResponse> {
  const maxAttempts = options.maxAttempts ?? 40;
  const retryDelayMilliseconds = options.retryDelayMilliseconds ?? 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await getHealth(fetcher);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, retryDelayMilliseconds));
      }
    }
  }

  throw lastError;
}
