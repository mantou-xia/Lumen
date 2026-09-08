import { ApplicationError } from "../application/errors.js";
import type { ModelProvider } from "./model-provider.js";

export interface ModelRequirements {
  structuredJson: boolean;
  streaming: boolean;
}

export class ProviderRouter {
  constructor(private readonly providers: readonly ModelProvider[]) {
    if (providers.length === 0) throw new Error("Provider Router 至少需要一个 Provider");
  }

  get defaultProvider(): ModelProvider {
    return this.providers[0]!;
  }

  resolve(requirements: ModelRequirements): ModelProvider {
    const provider = this.providers.find((candidate) => candidate.configured);
    if (provider !== undefined) return provider;
    if (requirements.streaming) {
      throw new ApplicationError({
        code: "MODEL_PROVIDER_NOT_CONFIGURED",
        message: "没有可用于流式任务的已配置 AI Provider",
        statusCode: 503,
      });
    }
    return this.defaultProvider;
  }
}
