import { z } from "zod";

import { ApplicationError } from "../application/errors.js";
import type {
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelProvider,
  ModelProviderId,
} from "./model-provider.js";

const responseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string(),
      reasoning_content: z.string().nullable().optional(),
      reasoning: z.string().nullable().optional(),
    }),
    finish_reason: z.string().nullable().optional(),
  })).min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

const providerTimeoutMilliseconds = 30_000;

export class OpenAiCompatibleProvider implements ModelProvider {
  readonly providerId: ModelProviderId;
  readonly modelId: string;
  readonly configured: boolean;
  readonly baseUrl: string | null;

  constructor(
    options: {
      providerId: ModelProviderId;
      baseUrl: string | null;
      apiKey: string | null;
      model: string | null;
      requiresApiKey: boolean;
      disableThinking: boolean;
    },
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.providerId = options.providerId;
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.disableThinking = options.disableThinking;
    this.modelId = options.model ?? "unconfigured";
    this.configured =
      options.baseUrl !== null &&
      options.model !== null &&
      (!options.requiresApiKey || options.apiKey !== null);
  }

  private readonly apiKey: string | null;
  private readonly disableThinking: boolean;

  describeInvocation(request: ModelInvocationRequest): Record<string, unknown> {
    return {
      endpoint: this.baseUrl === null ? null : `${this.baseUrl}/chat/completions`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: this.apiKey === null ? null : "[REDACTED]",
      },
      body: {
        model: this.modelId,
        temperature: 0.2,
        response_format: { type: "json_object" },
        thinking: this.disableThinking ? { type: "disabled" } : undefined,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt },
        ],
      },
    };
  }

  async invoke(request: ModelInvocationRequest): Promise<ModelInvocationResult> {
    if (!this.configured || this.baseUrl === null) {
      throw new ApplicationError({
        code: "MODEL_PROVIDER_NOT_CONFIGURED",
        message: this.providerId === "deepseek"
          ? "尚未配置 DeepSeek API Key，请设置 LUMEN_AI_API_KEY"
          : "尚未配置通用 AI Provider，请设置 LUMEN_AI_BASE_URL 和 LUMEN_AI_MODEL",
        statusCode: 503,
      });
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey !== null && this.apiKey.length > 0) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    let response: Response;
    try {
      const requestInit: RequestInit = {
        method: "POST",
        headers,
        body: JSON.stringify((this.describeInvocation(request).body)),
      };
      const timeoutSignal = AbortSignal.timeout(providerTimeoutMilliseconds);
      requestInit.signal =
        request.signal === undefined ? timeoutSignal : AbortSignal.any([request.signal, timeoutSignal]);
      response = await this.fetcher(`${this.baseUrl}/chat/completions`, requestInit);
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      const cancelled = request.signal?.aborted === true;
      throw new ApplicationError({
        code: cancelled ? "OPERATION_CANCELLED" : "MODEL_PROVIDER_FAILED",
        message: cancelled ? "翻译操作已取消" : timedOut ? "AI Provider 调用超时" : "无法连接 AI Provider",
        retryable: !cancelled,
        statusCode: cancelled ? 499 : 502,
        cause: error,
      });
    }

    if (!response.ok) {
      const providerError = await response.text().catch(() => "");
      throw new ApplicationError({
        code: "MODEL_PROVIDER_FAILED",
        message: `AI Provider 返回 HTTP ${response.status}`,
        retryable: response.status >= 500 || response.status === 429,
        statusCode: 502,
        cause: { status: response.status, statusText: response.statusText, responseBody: providerError },
      });
    }

    const rawResponse = await response.json().catch(() => null);
    const parsed = responseSchema.safeParse(rawResponse);
    if (!parsed.success) {
      throw new ApplicationError({
        code: "MODEL_OUTPUT_INVALID",
        message: "AI Provider 返回了无法识别的响应结构",
        statusCode: 502,
        cause: { validationIssues: parsed.error.issues, rawResponse },
      });
    }

    return {
      content: parsed.data.choices[0]!.message.content,
      reasoning: parsed.data.choices[0]!.message.reasoning_content
        ?? parsed.data.choices[0]!.message.reasoning
        ?? null,
      rawResponse,
      inputTokens: parsed.data.usage?.prompt_tokens ?? null,
      outputTokens: parsed.data.usage?.completion_tokens ?? null,
      finishReason: parsed.data.choices[0]!.finish_reason ?? null,
    };
  }
}
