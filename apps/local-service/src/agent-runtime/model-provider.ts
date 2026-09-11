export interface ModelInvocationRequest {
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
}

export interface ModelInvocationResult {
  content: string;
  reasoning?: string | null;
  rawResponse?: unknown;
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
  describeInvocation?(request: ModelInvocationRequest): Record<string, unknown>;
  invoke(request: ModelInvocationRequest): Promise<ModelInvocationResult>;
}
