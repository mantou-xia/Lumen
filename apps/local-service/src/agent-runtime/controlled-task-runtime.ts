import { ApplicationError } from "../application/errors.js";
import type {
  ClockPort,
  ControlledTaskRuntimePort,
  IdGeneratorPort,
  LexicalLocalizationTaskOutput,
  RecallTaskOutput,
  RuntimeRepositoryPort,
  TranslationTaskOutput,
  WorkspaceTaskOutput,
} from "../application/ports.js";
import type { WorkspaceReference } from "@lumen/api-contract";
import type { ModelProvider } from "./model-provider.js";
import { ProviderRouter } from "./provider-router.js";
import {
  createDefaultTaskRegistry,
  type TaskRegistry,
} from "./task-registry.js";

function normalizedOutput(content: string): unknown {
  const rawOutput = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(rawOutput) as unknown;
  } catch (error) {
    throw new ApplicationError({
      code: "MODEL_OUTPUT_INVALID",
      message: "AI 任务结果不是有效 JSON",
      statusCode: 502,
      cause: error,
    });
  }
}

function asApplicationError(error: unknown): ApplicationError {
  return error instanceof ApplicationError
    ? error
    : new ApplicationError({
        code: "MODEL_PROVIDER_FAILED",
        message: "AI 任务执行失败",
        retryable: true,
        statusCode: 502,
        cause: error,
      });
}

export class ControlledTaskRuntime implements ControlledTaskRuntimePort {
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly router: ProviderRouter;

  constructor(
    provider: ModelProvider,
    private readonly repository: RuntimeRepositoryPort,
    private readonly ids: IdGeneratorPort,
    private readonly clock: ClockPort,
    private readonly tasks: TaskRegistry = createDefaultTaskRegistry(),
  ) {
    this.router = new ProviderRouter([provider]);
  }

  get provider(): ModelProvider {
    return this.router.defaultProvider;
  }

  cancel(operationId: string): boolean {
    const controller = this.activeControllers.get(operationId);
    if (controller === undefined) return false;
    controller.abort();
    return true;
  }

  async executeTranslation(input: {
    operationId: string;
    selectedText: string;
    surroundingContext: string;
    signal?: AbortSignal;
  }): Promise<TranslationTaskOutput> {
    return this.execute("selection.translation.v1", {
      selectedText: input.selectedText,
      surroundingContext: input.surroundingContext,
    }, input.operationId, input.signal);
  }

  async executeRecall(input: {
    operationId: string;
    expression: string;
    currentContext: string;
    historicalMeaning: string;
    userInterpretation: string;
    signal?: AbortSignal;
  }): Promise<RecallTaskOutput> {
    return this.execute("recall.evaluation.v1", {
      expression: input.expression,
      currentContext: input.currentContext,
      historicalMeaning: input.historicalMeaning,
      userInterpretation: input.userInterpretation,
    }, input.operationId, input.signal);
  }

  async executeLexicalLocalization(input: {
    operationId: string;
    profile: Parameters<ControlledTaskRuntimePort["executeLexicalLocalization"]>[0]["profile"];
    signal?: AbortSignal;
  }): Promise<LexicalLocalizationTaskOutput> {
    return this.execute(
      "lexical.localization.v1",
      { profile: input.profile },
      input.operationId,
      input.signal,
    );
  }

  async executeWorkspace(input: {
    operationId: string;
    question: string;
    references: WorkspaceReference[];
    conversation: Array<{ question: string; answer: string }>;
    signal?: AbortSignal;
  }): Promise<WorkspaceTaskOutput> {
    return this.execute("workspace.answer.v1", {
      question: input.question,
      references: input.references,
      conversation: input.conversation,
    }, input.operationId, input.signal);
  }

  private async execute<Input, Output>(
    taskVersion: string,
    rawInput: Input,
    operationId: string,
    signal?: AbortSignal,
  ): Promise<Output> {
    const definition = this.tasks.get<Input, Output>(taskVersion);
    const input = definition.inputSchema.parse(rawInput);
    const prompt = definition.compile(input);
    const provider = this.router.resolve(definition.modelRequirements);
    this.repository.recordTaskCompiled({
      operationId,
      taskVersion: definition.version,
      contextPolicy: definition.contextPolicy,
      contextSnapshot: prompt.contextSnapshot,
      compiledAt: this.clock.now(),
    });
    const controller = new AbortController();
    const executionSignal = signal === undefined
      ? controller.signal
      : AbortSignal.any([signal, controller.signal]);
    this.activeControllers.set(operationId, controller);
    let lastError: ApplicationError | null = null;

    try {
      for (let attempt = 1; attempt <= definition.retryPolicy.maxAttempts; attempt += 1) {
        const invocationId = this.ids.generate();
        const startedAt = this.clock.now();
        this.repository.startInvocation({
          invocationId,
          operationId,
          providerId: provider.providerId,
          modelId: provider.modelId,
          startedAt,
        });
        const started = performance.now();

        try {
          const result = await provider.invoke({
            systemPrompt: attempt === 1
              ? prompt.systemPrompt
              : `${prompt.systemPrompt}\n上一次输出未通过执行要求。仅返回符合指定结构的 JSON，不要添加 Markdown。`,
            userPrompt: prompt.userPrompt,
            signal: executionSignal,
          });
          const parsed = definition.outputSchema.safeParse(normalizedOutput(result.content));
          if (!parsed.success) {
            throw new ApplicationError({
              code: "MODEL_OUTPUT_INVALID",
              message: "AI 任务结果未通过结构校验",
              statusCode: 502,
              cause: parsed.error,
            });
          }
          definition.validate?.(input, parsed.data);
          this.repository.completeInvocation({
            invocationId,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            finishReason: result.finishReason ?? null,
            latencyMs: Math.round(performance.now() - started),
            completedAt: this.clock.now(),
          });
          return parsed.data;
        } catch (error) {
          const applicationError = asApplicationError(error);
          const completedAt = this.clock.now();
          const latencyMs = Math.round(performance.now() - started);
          if (applicationError.code === "OPERATION_CANCELLED") {
            this.repository.cancelInvocation({ invocationId, latencyMs, completedAt });
            throw applicationError;
          }
          this.repository.failInvocation({
            invocationId,
            errorCode: applicationError.code,
            errorMessage: applicationError.message,
            latencyMs,
            completedAt,
          });
          lastError = applicationError;
          const canRetry = applicationError.retryable
            || (definition.retryPolicy.retryInvalidOutput
              && applicationError.code === "MODEL_OUTPUT_INVALID");
          if (!canRetry || attempt === definition.retryPolicy.maxAttempts) throw applicationError;
        }
      }
    } finally {
      if (this.activeControllers.get(operationId) === controller) {
        this.activeControllers.delete(operationId);
      }
    }

    throw lastError ?? new ApplicationError({
      code: "MODEL_PROVIDER_FAILED",
      message: `AI 任务 ${definition.taskType} 未返回结果`,
      statusCode: 502,
    });
  }
}
