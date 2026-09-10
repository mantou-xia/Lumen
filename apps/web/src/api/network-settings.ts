import {
  applicationErrorSchema,
  networkRouteStatusSchema,
  type NetworkRouteStatus,
  type UpdateNetworkSettingsRequest,
} from "@lumen/api-contract";

import type { FetchLike } from "./health";

async function responseError(response: Response): Promise<Error> {
  const parsed = applicationErrorSchema.safeParse(await response.json().catch(() => null));
  return new Error(parsed.success ? parsed.data.message : `网络设置请求失败：HTTP ${response.status}`);
}

export async function getNetworkSettings(
  fetcher: FetchLike = fetch,
): Promise<NetworkRouteStatus> {
  const response = await fetcher("/api/settings/network", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await responseError(response);
  return networkRouteStatusSchema.parse(await response.json());
}

export async function updateNetworkSettings(
  input: UpdateNetworkSettingsRequest,
  fetcher: FetchLike = fetch,
): Promise<NetworkRouteStatus> {
  const response = await fetcher("/api/settings/network", {
    method: "PUT",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await responseError(response);
  return networkRouteStatusSchema.parse(await response.json());
}
