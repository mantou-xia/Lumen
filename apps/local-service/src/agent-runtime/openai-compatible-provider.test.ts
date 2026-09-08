import { describe, expect, it } from "vitest";

import { OpenAiCompatibleProvider } from "./openai-compatible-provider.js";

function successfulResponse(): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: "{\"result\":\"ok\"}" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("OpenAiCompatibleProvider", () => {
  it("DeepSeek 预设使用固定模型、Bearer Key 并关闭思考模式", async () => {
    const calls: Parameters<typeof fetch>[] = [];
    const fetcher: typeof fetch = async (...arguments_) => {
      calls.push(arguments_);
      return successfulResponse();
    };
    const provider = new OpenAiCompatibleProvider({
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "deepseek-key",
      model: "deepseek-v4-flash",
      requiresApiKey: true,
      disableThinking: true,
    }, fetcher);

    expect(provider.configured).toBe(true);
    const result = await provider.invoke({ systemPrompt: "输出 JSON", userPrompt: "translate" });

    expect(calls).toHaveLength(1);
    const [url, request] = calls[0]!;
    expect(request).toBeDefined();
    if (request === undefined) throw new Error("测试请求缺少 RequestInit");
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect((request.headers as Record<string, string>).authorization).toBe("Bearer deepseek-key");
    expect(JSON.parse(request.body as string)).toMatchObject({
      model: "deepseek-v4-flash",
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    });
    expect(result.finishReason).toBe("stop");
  });

  it("DeepSeek 缺少 API Key 时保持未配置状态", async () => {
    const provider = new OpenAiCompatibleProvider({
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: null,
      model: "deepseek-v4-flash",
      requiresApiKey: true,
      disableThinking: true,
    });

    expect(provider.configured).toBe(false);
    await expect(provider.invoke({ systemPrompt: "输出 JSON", userPrompt: "translate" }))
      .rejects.toThrow("尚未配置 DeepSeek API Key");
  });

  it("通用中转站允许空 API Key 且不发送 DeepSeek 专属参数", async () => {
    const calls: Parameters<typeof fetch>[] = [];
    const fetcher: typeof fetch = async (...arguments_) => {
      calls.push(arguments_);
      return successfulResponse();
    };
    const provider = new OpenAiCompatibleProvider({
      providerId: "openai-compatible",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: null,
      model: "local-model",
      requiresApiKey: false,
      disableThinking: false,
    }, fetcher);

    expect(provider.configured).toBe(true);
    await provider.invoke({ systemPrompt: "输出 JSON", userPrompt: "translate" });

    const [, request] = calls[0]!;
    expect(request).toBeDefined();
    if (request === undefined) throw new Error("测试请求缺少 RequestInit");
    expect((request.headers as Record<string, string>).authorization).toBeUndefined();
    expect(JSON.parse(request.body as string)).not.toHaveProperty("thinking");
  });

  it("上游 AbortSignal 中止时返回可识别的取消错误", async () => {
    const fetcher: typeof fetch = async (_input, init) => new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    });
    const provider = new OpenAiCompatibleProvider({
      providerId: "openai-compatible",
      baseUrl: "http://provider.test/v1",
      apiKey: null,
      model: "cancel-model",
      requiresApiKey: false,
      disableThinking: false,
    }, fetcher);
    const controller = new AbortController();
    const pending = provider.invoke({
      systemPrompt: "输出 JSON",
      userPrompt: "translate",
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: "OPERATION_CANCELLED",
      retryable: false,
      statusCode: 499,
    });
  });
});
