import { z } from "zod";

import { ApplicationError } from "../application/errors.js";
import type {
  LexicalLocalizationTaskOutput,
  RecallTaskOutput,
  TranslationTaskOutput,
  WorkspaceTaskOutput,
} from "../application/ports.js";
import type { ModelRequirements } from "./provider-router.js";

export interface CompiledTaskPrompt {
  systemPrompt: string;
  userPrompt: string;
  contextSnapshot: string;
}

export interface TaskDefinition<Input, Output> {
  taskType: string;
  version: string;
  promptVersion: string;
  inputSchema: z.ZodType<Input>;
  outputSchema: z.ZodType<Output>;
  allowedReferenceTypes: string[];
  contextPolicy: string;
  contextBudget: number;
  modelRequirements: ModelRequirements;
  cachePolicy: "domain-result" | "none";
  retryPolicy: { maxAttempts: number; retryInvalidOutput: boolean };
  timeoutMilliseconds: number;
  compile(input: Input): CompiledTaskPrompt;
  validate?(input: Input, output: Output): void;
}

export class TaskRegistry {
  private readonly definitions = new Map<string, TaskDefinition<unknown, unknown>>();

  register<Input, Output>(definition: TaskDefinition<Input, Output>): void {
    if (this.definitions.has(definition.version)) {
      throw new Error(`Task Definition 已重复注册：${definition.version}`);
    }
    this.definitions.set(
      definition.version,
      definition as TaskDefinition<unknown, unknown>,
    );
  }

  get<Input, Output>(version: string): TaskDefinition<Input, Output> {
    const definition = this.definitions.get(version);
    if (definition === undefined) {
      throw new ApplicationError({
        code: "TASK_DEFINITION_NOT_FOUND",
        message: `未注册 Task Definition：${version}`,
        statusCode: 500,
      });
    }
    return definition as TaskDefinition<Input, Output>;
  }
}

const translationInputSchema = z.object({
  selectedText: z.string().min(1),
  surroundingContext: z.string().min(1),
});

const translationOutputSchema = z.object({
  contextualTranslation: z.string().min(1),
  contextualMeaning: z.string().min(1),
  expressionType: z.enum(["word", "phrase", "collocation", "sentence"]),
  explanation: z.string(),
  uncertainty: z.string(),
});

const recallInputSchema = z.object({
  expression: z.string().min(1),
  currentContext: z.string().min(1),
  historicalMeaning: z.string(),
  userInterpretation: z.string().min(1),
});

const recallOutputSchema = z.object({
  verdict: z.enum(["understood", "partially_understood", "misunderstood"]),
  feedback: z.string().min(1),
  contextualMeaning: z.string().min(1),
  missingPoints: z.array(z.string()),
});

const lexicalInputSchema = z.object({
  profile: z.object({
    lemma: z.string().min(1),
    etymology: z.string(),
    partsOfSpeech: z.array(z.object({
      partOfSpeech: z.string().min(1),
      senses: z.array(z.object({
        gloss: z.string().min(1),
        usageLabels: z.array(z.string()),
      })),
    })),
  }).passthrough(),
});

const lexicalOutputSchema = z.object({
  senses: z.array(z.object({
    sourceGloss: z.string().min(1),
    chineseGloss: z.string().min(1),
    usageNote: z.string(),
  })).min(1),
  etymologySummary: z.string(),
});

const workspaceInputSchema = z.object({
  question: z.string().min(1),
  references: z.array(z.object({
    referenceId: z.string().min(1),
    type: z.string().min(1),
    label: z.string().min(1),
    content: z.string().min(1),
  }).passthrough()).min(1),
  conversation: z.array(z.object({ question: z.string(), answer: z.string() })).max(6),
});

const workspaceOutputSchema = z.object({
  content: z.string().min(1),
  citationReferenceIds: z.array(z.string().min(1)),
});

function contextSnapshot(taskType: string, policy: string, payload: unknown): string {
  return JSON.stringify({
    schemaVersion: 1,
    type: "runtime.context-bundle",
    payload: {
      taskType,
      policy,
      primaryContext: payload,
      references: [],
      compilerVersion: "context-compiler.v1",
    },
  });
}

export function createDefaultTaskRegistry(): TaskRegistry {
  const registry = new TaskRegistry();

  registry.register<z.infer<typeof translationInputSchema>, TranslationTaskOutput>({
    taskType: "selection.translation",
    version: "selection.translation.v1",
    promptVersion: "selection.translation.prompt.v1",
    inputSchema: translationInputSchema,
    outputSchema: translationOutputSchema,
    allowedReferenceTypes: ["selection"],
    contextPolicy: "selection.surrounding-context",
    contextBudget: 12_000,
    modelRequirements: { structuredJson: true, streaming: false },
    cachePolicy: "domain-result",
    retryPolicy: { maxAttempts: 2, retryInvalidOutput: true },
    timeoutMilliseconds: 30_000,
    compile: (input) => ({
      systemPrompt: [
        "你是 Lumen 的受控阅读翻译任务。",
        "只解释用户明确选中的英文表达在给定语境中的含义，不扩展到全文总结。",
        "返回单个 JSON 对象，字段必须为 contextualTranslation、contextualMeaning、expressionType、explanation、uncertainty。",
        "expressionType 只能是 word、phrase、collocation、sentence。",
        "所有解释使用简体中文；不确定时在 uncertainty 中明确说明，没有不确定性则返回空字符串。",
      ].join("\n"),
      userPrompt: JSON.stringify(input),
      contextSnapshot: contextSnapshot("selection.translation", "selection.surrounding-context", input),
    }),
  });

  registry.register<z.infer<typeof recallInputSchema>, RecallTaskOutput>({
    taskType: "recall.evaluation",
    version: "recall.evaluation.v1",
    promptVersion: "recall.evaluation.prompt.v1",
    inputSchema: recallInputSchema,
    outputSchema: recallOutputSchema,
    allowedReferenceTypes: ["recall_occurrence", "learning_context"],
    contextPolicy: "recall.current-and-historical-context",
    contextBudget: 12_000,
    modelRequirements: { structuredJson: true, streaming: false },
    cachePolicy: "none",
    retryPolicy: { maxAttempts: 2, retryInvalidOutput: true },
    timeoutMilliseconds: 30_000,
    compile: (input) => ({
      systemPrompt: [
        "你是 Lumen 的受控阅读回忆判断任务。",
        "根据当前语境判断用户对表达含义的理解，不评价语言风格，不扩展成教学长文。",
        "返回单个 JSON 对象：verdict、feedback、contextualMeaning、missingPoints。",
        "verdict 只能是 understood、partially_understood、misunderstood。",
        "所有反馈使用简体中文。",
      ].join("\n"),
      userPrompt: JSON.stringify(input),
      contextSnapshot: contextSnapshot("recall.evaluation", "recall.current-and-historical-context", input),
    }),
  });

  registry.register<z.infer<typeof lexicalInputSchema>, LexicalLocalizationTaskOutput>({
    taskType: "lexical.localization",
    version: "lexical.localization.v1",
    promptVersion: "lexical.localization.prompt.v1",
    inputSchema: lexicalInputSchema,
    outputSchema: lexicalOutputSchema,
    allowedReferenceTypes: ["lexical_profile"],
    contextPolicy: "explicit.lexical-profile",
    contextBudget: 24_000,
    modelRequirements: { structuredJson: true, streaming: false },
    cachePolicy: "domain-result",
    retryPolicy: { maxAttempts: 2, retryInvalidOutput: true },
    timeoutMilliseconds: 30_000,
    compile: ({ profile }) => ({
      systemPrompt: [
        "你是 Lumen 的受控英文词汇资料本地化任务。",
        "输入事实只来自 English Wiktionary；不得补充、合并或改写英文义项。",
        "为每个 sourceGloss 按输入顺序提供简体中文释义和简短用法说明。",
        "返回单个 JSON 对象，字段必须为 senses、etymologySummary。",
        "每项 senses 必须包含原样 sourceGloss、chineseGloss、usageNote。",
        "没有可靠词源内容时 etymologySummary 返回空字符串。",
      ].join("\n"),
      userPrompt: JSON.stringify({
        lemma: profile.lemma,
        senses: profile.partsOfSpeech.flatMap((part) =>
          part.senses.map((sense) => ({
            partOfSpeech: part.partOfSpeech,
            sourceGloss: sense.gloss,
            usageLabels: sense.usageLabels,
          })),
        ),
        etymology: profile.etymology,
      }),
      contextSnapshot: contextSnapshot("lexical.localization", "explicit.lexical-profile", profile),
    }),
    validate: ({ profile }, output) => {
      const sourceGlosses = profile.partsOfSpeech.flatMap((part) =>
        part.senses.map((sense) => sense.gloss),
      );
      const outputGlosses = output.senses.map((sense) => sense.sourceGloss);
      if (JSON.stringify(outputGlosses) !== JSON.stringify(sourceGlosses)) {
        throw new ApplicationError({
          code: "MODEL_OUTPUT_INVALID",
          message: "AI 词汇本地化结果未通过事实对齐校验",
          statusCode: 502,
        });
      }
    },
  });

  registry.register<z.infer<typeof workspaceInputSchema>, WorkspaceTaskOutput>({
    taskType: "workspace.answer",
    version: "workspace.answer.v1",
    promptVersion: "workspace.answer.prompt.v1",
    inputSchema: workspaceInputSchema,
    outputSchema: workspaceOutputSchema,
    allowedReferenceTypes: [
      "selection",
      "paragraph",
      "translation",
      "learning_context",
      "annotation",
      "workspace_turn",
    ],
    contextPolicy: "explicit.references-and-recent-turns",
    contextBudget: 24_000,
    modelRequirements: { structuredJson: true, streaming: false },
    cachePolicy: "none",
    retryPolicy: { maxAttempts: 2, retryInvalidOutput: true },
    timeoutMilliseconds: 30_000,
    compile: (input) => ({
      systemPrompt: [
        "你是 Lumen 的受控阅读上下文助手。",
        "只根据本回合明确提供的 references 和最近对话回答，不搜索其他文档或知识库。",
        "返回 JSON：content、citationReferenceIds。",
        "citationReferenceIds 只能使用输入中已有的 referenceId；无法回答时明确说明缺少依据。",
        "回答使用简体中文，不自动创建学习项或标注。",
      ].join("\n"),
      userPrompt: JSON.stringify(input),
      contextSnapshot: contextSnapshot(
        "workspace.answer",
        "explicit.references-and-recent-turns",
        input,
      ),
    }),
    validate: (input, output) => {
      const allowed = new Set(input.references.map((reference) => reference.referenceId));
      if (output.citationReferenceIds.some((referenceId) => !allowed.has(referenceId))) {
        throw new ApplicationError({
          code: "MODEL_OUTPUT_INVALID",
          message: "Workspace 回答引用了未提供的 Reference",
          statusCode: 502,
        });
      }
    },
  });

  return registry;
}
