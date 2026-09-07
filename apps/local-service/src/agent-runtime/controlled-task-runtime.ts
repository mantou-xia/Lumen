import { z } from "zod";
import { randomUUID } from "node:crypto";

import type { ExpressionType } from "@lumen/api-contract";

import { ApplicationError } from "../application/errors.js";
import type { RuntimeRepository } from "../infrastructure/runtime/runtime-repository.js";
import type { ModelProvider } from "./model-provider.js";

const translationOutputSchema = z.object({
  contextualTranslation: z.string().min(1),
  contextualMeaning: z.string().min(1),
  expressionType: z.enum(["word", "phrase", "collocation", "sentence"]),
  explanation: z.string(),
  uncertainty: z.string(),
});

const recallOutputSchema = z.object({
  verdict: z.enum(["understood", "partially_understood", "misunderstood"]),
  feedback: z.string().min(1),
  contextualMeaning: z.string().min(1),
  missingPoints: z.array(z.string()),
});

export interface TranslationTaskOutput {
  contextualTranslation: string;
  contextualMeaning: string;
  expressionType: ExpressionType;
  explanation: string;
  uncertainty: string;
}

export type RecallTaskOutput = z.infer<typeof recallOutputSchema>;

export class ControlledTaskRuntime {
  constructor(
    readonly provider: ModelProvider,
    private readonly repository: RuntimeRepository,
  ) {}

  async executeTranslation(input: {
    operationId: string;
    selectedText: string;
    surroundingContext: string;
  }): Promise<TranslationTaskOutput> {
    const invocationId = randomUUID();
    const startedAt = new Date().toISOString();
    this.repository.startInvocation({
      invocationId,
      operationId: input.operationId,
      providerId: this.provider.providerId,
      modelId: this.provider.modelId,
      startedAt,
    });
    const started = performance.now();

    try {
      const result = await this.provider.invoke({
        systemPrompt: [
          "你是 Lumen 的受控阅读翻译任务。",
          "只解释用户明确选中的英文表达在给定语境中的含义，不扩展到全文总结。",
          "返回单个 JSON 对象，字段必须为 contextualTranslation、contextualMeaning、expressionType、explanation、uncertainty。",
          "expressionType 只能是 word、phrase、collocation、sentence。",
          "所有解释使用简体中文；不确定时在 uncertainty 中明确说明，没有不确定性则返回空字符串。",
        ].join("\n"),
        userPrompt: JSON.stringify({
          selectedText: input.selectedText,
          surroundingContext: input.surroundingContext,
        }),
      });
      const rawOutput = result.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsedJson: unknown = JSON.parse(rawOutput);
      const parsed = translationOutputSchema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new ApplicationError({
          code: "MODEL_OUTPUT_INVALID",
          message: "AI 翻译结果未通过结构校验",
          statusCode: 502,
          cause: parsed.error,
        });
      }
      this.repository.completeInvocation({
        invocationId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: Math.round(performance.now() - started),
        completedAt: new Date().toISOString(),
      });
      return parsed.data;
    } catch (error) {
      const applicationError =
        error instanceof ApplicationError
          ? error
          : new ApplicationError({
              code: "MODEL_OUTPUT_INVALID",
              message: "AI 翻译结果不是有效 JSON",
              statusCode: 502,
              cause: error,
            });
      this.repository.failInvocation({
        invocationId,
        errorCode: applicationError.code,
        errorMessage: applicationError.message,
        latencyMs: Math.round(performance.now() - started),
        completedAt: new Date().toISOString(),
      });
      throw applicationError;
    }
  }

  async executeRecall(input: {
    operationId: string;
    expression: string;
    currentContext: string;
    historicalMeaning: string;
    userInterpretation: string;
  }): Promise<RecallTaskOutput> {
    const invocationId = randomUUID();
    const startedAt = new Date().toISOString();
    this.repository.startInvocation({
      invocationId,
      operationId: input.operationId,
      providerId: this.provider.providerId,
      modelId: this.provider.modelId,
      startedAt,
    });
    const started = performance.now();
    try {
      const result = await this.provider.invoke({
        systemPrompt: [
          "你是 Lumen 的受控阅读回忆判断任务。",
          "根据当前语境判断用户对表达含义的理解，不评价语言风格，不扩展成教学长文。",
          "返回单个 JSON 对象：verdict、feedback、contextualMeaning、missingPoints。",
          "verdict 只能是 understood、partially_understood、misunderstood。",
          "所有反馈使用简体中文。",
        ].join("\n"),
        userPrompt: JSON.stringify(input),
      });
      const rawOutput = result.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = recallOutputSchema.safeParse(JSON.parse(rawOutput));
      if (!parsed.success) {
        throw new ApplicationError({
          code: "MODEL_OUTPUT_INVALID",
          message: "AI Recall 结果未通过结构校验",
          statusCode: 502,
          cause: parsed.error,
        });
      }
      this.repository.completeInvocation({
        invocationId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: Math.round(performance.now() - started),
        completedAt: new Date().toISOString(),
      });
      return parsed.data;
    } catch (error) {
      const applicationError = error instanceof ApplicationError
        ? error
        : new ApplicationError({
            code: "MODEL_OUTPUT_INVALID",
            message: "AI Recall 结果不是有效 JSON",
            statusCode: 502,
            cause: error,
          });
      this.repository.failInvocation({
        invocationId,
        errorCode: applicationError.code,
        errorMessage: applicationError.message,
        latencyMs: Math.round(performance.now() - started),
        completedAt: new Date().toISOString(),
      });
      throw applicationError;
    }
  }
}
