export interface ModelInvocationRequest {
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
}

export interface ModelInvocationResult {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason?: string | null;
}

export type ModelProviderId = "deepseek" | "openai-compatible";

export interface ModelProvider {
  readonly providerId: ModelProviderId;
  readonly modelId: string;
  readonly configured: boolean;
  readonly baseUrl: string | null;
  invoke(request: ModelInvocationRequest): Promise<ModelInvocationResult>;
}
