import type {
  NetworkRouteStatus,
  NetworkSettings,
  UpdateNetworkSettingsRequest,
} from "@lumen/api-contract";

import type { OutboundHttpClient } from "../infrastructure/http/outbound-http.js";
import type { ClockPort, TransactionPort } from "./ports.js";

interface NetworkSettingsStore {
  get(): NetworkSettings;
  save(settings: NetworkSettings, updatedAt: string): void;
}

export class NetworkSettingsApplication {
  constructor(private readonly dependencies: {
    clock: ClockPort;
    outboundHttp: OutboundHttpClient;
    repository: NetworkSettingsStore;
    transaction: TransactionPort;
  }) {}

  async getStatus(): Promise<NetworkRouteStatus> {
    return this.dependencies.outboundHttp.getRouteStatus();
  }

  async update(input: UpdateNetworkSettingsRequest): Promise<NetworkRouteStatus> {
    const settings: NetworkSettings = {
      ...input,
      proxyHost: input.proxyHost.trim(),
    };
    this.dependencies.transaction.run(() => {
      this.dependencies.repository.save(settings, this.dependencies.clock.now());
    });
    return this.dependencies.outboundHttp.getRouteStatus();
  }
}
