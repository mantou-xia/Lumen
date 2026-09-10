import { describe, expect, it } from "vitest";

import { ApplicationError } from "../application/errors.js";
import type { ModelProvider } from "./model-provider.js";
import { ProviderRouter } from "./provider-router.js";
import { createDefaultTaskRegistry } from "./task-registry.js";

function provider(configured: boolean, modelId: string): ModelProvider {
  return {
    providerId: "openai-compatible",
    modelId,
    configured,
    baseUrl: configured ? "http://provider.test/v1" : null,
    invoke: async () => ({ content: "{}", inputTokens: null, outputTokens: null }),
  };
}

describe("Controlled Task Registry", () => {
  it("集中声明版本、上下文、模型、缓存、重试与超时策略", () => {
    const definition = createDefaultTaskRegistry().get(
      "selection.translation.v1",
    );

    expect(definition).toMatchObject({
      taskType: "selection.translation",
      promptVersion: "selection.translation.prompt.v1",
      contextPolicy: "selection.surrounding-context",
      modelRequirements: { structuredJson: true, streaming: false },
      cachePolicy: "domain-result",
      retryPolicy: { maxAttempts: 2, retryInvalidOutput: true },
      timeoutMilliseconds: 30_000,
    });
  });

  it("Provider Router 只选择已配置 Provider，并保留确定性默认项", () => {
    const unconfigured = provider(false, "unconfigured");
    const configured = provider(true, "configured");
    const router = new ProviderRouter([unconfigured, configured]);

    expect(router.defaultProvider).toBe(unconfigured);
    expect(router.resolve({ structuredJson: true, streaming: false })).toBe(configured);
  });

  it("Workspace 正文内联来源只能指向输入中的 Reference", () => {
    const definition = createDefaultTaskRegistry().get<
      {
        question: string;
        contextMode: "full_document";
        references: Array<{ referenceId: string; type: string; label: string; content: string }>;
      },
      { content: string; citationReferenceIds: string[]; outcome: "answered" }
    >("workspace.answer.v2");
    const input = {
      question: "这句话是什么意思？",
      contextMode: "full_document" as const,
      references: [{ referenceId: "reference-1", type: "selection", label: "原文", content: "Context matters." }],
    };

    expect(() => definition.validate?.(input, {
      content: "依据见[原文](lumen-reference:reference-1)。",
      citationReferenceIds: ["reference-1"],
      outcome: "answered",
    })).not.toThrow();
    expect(() => definition.validate?.(input, {
      content: "依据见[伪造来源](lumen-reference:reference-missing)。",
      citationReferenceIds: [],
      outcome: "answered",
    })).toThrow(ApplicationError);
  });
});
