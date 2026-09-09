import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { ControlledTaskRuntime } from "./agent-runtime/controlled-task-runtime.js";
import type { ModelProvider } from "./agent-runtime/model-provider.js";
import { ApplicationError } from "./application/errors.js";
import type { LexicalSourcePort } from "./application/ports.js";
import { openDatabase } from "./infrastructure/database/database.js";
import {
  createAnnotationApplication,
  createLibraryApplication,
  createLearningApplication,
  createLexicalApplication,
  createReaderApplication,
  createRecallApplication,
  createResourceApplication,
  createSourceMappingApplication,
  createRuntimeApplication,
  createTranslationApplication,
  createWorkspaceApplication,
  randomIdGenerator,
  systemClock,
} from "./composition-root.js";
import { ManagedFileStore } from "./infrastructure/files/managed-file-store.js";
import { RuntimeRepository } from "./infrastructure/runtime/runtime-repository.js";

const closeCallbacks: Array<() => Promise<void> | void> = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const close of closeCallbacks.splice(0).reverse()) {
    await close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createDefaultProvider(): ModelProvider {
  return {
    providerId: "openai-compatible",
    modelId: "test-model",
    configured: true,
    baseUrl: "http://provider.test/v1",
    invoke: async (request) => ({
      content: request.systemPrompt.includes("受控阅读上下文助手")
        ? JSON.stringify({
            content: "这段表达强调真正重要的内容需要结合上下文理解。",
            citationReferenceIds: [
              (JSON.parse(request.userPrompt) as {
                references: Array<{ referenceId: string }>;
              }).references[0]?.referenceId,
            ].filter((value): value is string => value !== undefined),
          })
        : request.systemPrompt.includes("回忆判断")
        ? JSON.stringify({
            verdict: "understood",
            feedback: "你的理解符合当前语境。",
            contextualMeaning: "凭内心而不是只凭表面来理解。",
            missingPoints: [],
          })
        : JSON.stringify({
            contextualTranslation: "只有用心才能看得清楚。",
            contextualMeaning: "强调真正重要的事需要用心体会。",
            expressionType: "sentence",
            explanation: "这是带有格言意味的完整句子。",
            uncertainty: "",
          }),
      inputTokens: 20,
      outputTokens: 30,
    }),
  };
}

async function createTestApp(
  provider: ModelProvider = createDefaultProvider(),
  lexicalSource: LexicalSourcePort = { fetchEntry: async () => null },
) {
  const directory = mkdtempSync(join(tmpdir(), "lumen-local-service-"));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, "lumen.db"));
  const fileStore = new ManagedFileStore(directory);
  await fileStore.initialize();
  const library = createLibraryApplication(database, fileStore);
  const reader = createReaderApplication(database, fileStore);
  const resources = createResourceApplication(database, fileStore);
  const sourceMappings = createSourceMappingApplication(database);
  const runtime = new ControlledTaskRuntime(
    provider,
    new RuntimeRepository(database.connection),
    randomIdGenerator,
    systemClock,
  );
  const translation = createTranslationApplication(database, runtime);
  const annotations = createAnnotationApplication(database);
  const learning = createLearningApplication(database);
  const lexical = createLexicalApplication(database, runtime, lexicalSource);
  const recall = createRecallApplication(database, runtime);
  const runtimeApplication = createRuntimeApplication(database, runtime);
  const workspace = createWorkspaceApplication(database, runtime);
  const app = buildApp({
    annotations,
    database,
    library,
    reader,
    translation,
    learning,
    lexical,
    recall,
    runtime: runtimeApplication,
    resources,
    sourceMappings,
    workspace,
  });
  closeCallbacks.push(() => database.close(), () => app.close());
  return { app, database, translation };
}

describe("GET /api/health", () => {
  it("返回 Local Service 和数据库健康状态", async () => {
    const { app } = await createTestApp();

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "lumen-local-service",
      version: "0.1.0",
      database: {
        status: "ready",
        schemaVersion: 15,
      },
    });
  });
});

describe("Lexical Profile", () => {
  it("三种语境翻译保持独立，并共享同一带来源版本的词汇资料缓存", async () => {
    let localizationCount = 0;
    let sophisticatedFetchCount = 0;
    const provider: ModelProvider = {
      providerId: "openai-compatible",
      modelId: "lexical-test-model",
      configured: true,
      baseUrl: "http://provider.test/v1",
      invoke: async (request) => {
        if (request.systemPrompt.includes("词汇资料本地化")) {
          localizationCount += 1;
          const input = JSON.parse(request.userPrompt) as {
            senses: Array<{ sourceGloss: string }>;
          };
          return {
            content: JSON.stringify({
              senses: input.senses.map((sense) => ({
                sourceGloss: sense.sourceGloss,
                chineseGloss: "复杂精密的；老练的",
                usageNote: "具体含义由当前搭配决定。",
              })),
              etymologySummary: "源自 sophisticate。",
            }),
            inputTokens: 20,
            outputTokens: 30,
          };
        }
        const input = JSON.parse(request.userPrompt) as { selectedText: string };
        const translations: Record<string, string> = {
          "sophisticated caching mechanism": "精密的缓存机制",
          "a sophisticated investor": "一位老练的投资者",
          "a sophisticated taste": "一种高雅成熟的品味",
        };
        return {
          content: JSON.stringify({
            contextualTranslation: translations[input.selectedText] ?? input.selectedText,
            contextualMeaning: `当前语境中的 ${input.selectedText}`,
            expressionType: "phrase",
            explanation: "",
            uncertainty: "",
          }),
          inputTokens: 20,
          outputTokens: 30,
        };
      },
    };
    let sourceCallCount = 0;
    const lexicalSource: LexicalSourcePort = {
      fetchEntry: async (lemma) => {
        sourceCallCount += 1;
        if (lemma !== "sophisticated") return null;
        sophisticatedFetchCount += 1;
        return {
          entryId: "en.wiktionary:123",
          lemma: "sophisticated",
          revisionId: String(456 + sophisticatedFetchCount),
          revisionTimestamp: "2026-09-08T00:00:00.000Z",
          sourceUrl: "https://en.wiktionary.org/wiki/sophisticated",
          wikitext: `==English==
===Pronunciation===
* {{IPA|en|/səˈfɪstɪkeɪtɪd/}}
===Adjective===
# Having obtained worldly experience.
# Complicated, especially of technology.`,
        };
      },
    };
    const { app, database } = await createTestApp(provider, lexicalSource);
    const sourceText = [
      "sophisticated caching mechanism",
      "a sophisticated investor",
      "a sophisticated taste",
    ].join("; ");
    const imported = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("lexical.md"),
      },
      payload: Buffer.from(`# Lexical\n\n${sourceText}`),
    });
    const documentId = imported.json().document.documentId;
    const revisionId = imported.json().document.activeRevisionId;
    const reader = await app.inject({ method: "GET", url: `/api/reader/documents/${documentId}` });
    const paragraph = reader.json().blocks[1];
    const translationIds: string[] = [];
    const contextualTranslations: string[] = [];
    for (const selection of [
      "sophisticated caching mechanism",
      "a sophisticated investor",
      "a sophisticated taste",
    ]) {
      const start = paragraph.text.indexOf(selection);
      const translated = await app.inject({
        method: "POST",
        url: `/api/reader/documents/${documentId}/translations`,
        payload: {
          revisionId,
          start: { blockId: paragraph.blockId, offset: start },
          end: { blockId: paragraph.blockId, offset: start + selection.length },
          selectedText: selection,
        },
      });
      translationIds.push(translated.json().translationId);
      contextualTranslations.push(translated.json().contextualTranslation);
    }

    const firstProfile = await app.inject({
      method: "GET",
      url: `/api/translations/${translationIds[0]}/lexical-profile`,
    });
    const secondProfile = await app.inject({
      method: "GET",
      url: `/api/translations/${translationIds[1]}/lexical-profile`,
    });
    const thirdProfile = await app.inject({
      method: "GET",
      url: `/api/translations/${translationIds[2]}/lexical-profile`,
    });

    expect(contextualTranslations).toEqual([
      "精密的缓存机制",
      "一位老练的投资者",
      "一种高雅成熟的品味",
    ]);
    expect([firstProfile, secondProfile, thirdProfile].map((response) => response.json()))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          matchedLemma: "sophisticated",
          status: "ready",
          localizationStatus: "ready",
          attribution: expect.objectContaining({ sourceName: "English Wiktionary" }),
        }),
      ]));
    expect(sourceCallCount).toBe(2);
    expect(localizationCount).toBe(1);

    await app.inject({
      method: "POST",
      url: "/api/learning-items",
      payload: { translationId: translationIds[0] },
    });
    const beforeRefresh = database.connection.prepare(
      "SELECT translation_snapshot FROM learning_contexts LIMIT 1",
    ).get();
    const refreshed = await app.inject({
      method: "POST",
      url: `/api/translations/${translationIds[0]}/lexical-profile/refresh`,
    });
    const afterRefresh = database.connection.prepare(
      "SELECT translation_snapshot FROM learning_contexts LIMIT 1",
    ).get();
    expect(refreshed.json().profile.sourceRevisionId).toBe("458");
    expect(localizationCount).toBe(2);
    expect(afterRefresh).toEqual(beforeRefresh);
  });

  it("离线且没有缓存时返回不影响翻译结果的明确降级", async () => {
    const lexicalSource: LexicalSourcePort = {
      fetchEntry: async () => {
        throw new ApplicationError({
          code: "LEXICAL_SOURCE_UNAVAILABLE",
          message: "offline",
          statusCode: 503,
          retryable: true,
        });
      },
    };
    const { app } = await createTestApp(createDefaultProvider(), lexicalSource);
    const imported = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("offline.md"),
      },
      payload: Buffer.from("# Offline\n\nsophisticated"),
    });
    const reader = await app.inject({
      method: "GET",
      url: `/api/reader/documents/${imported.json().document.documentId}`,
    });
    const paragraph = reader.json().blocks[1];
    const translated = await app.inject({
      method: "POST",
      url: `/api/reader/documents/${imported.json().document.documentId}/translations`,
      payload: {
        revisionId: imported.json().document.activeRevisionId,
        start: { blockId: paragraph.blockId, offset: 0 },
        end: { blockId: paragraph.blockId, offset: paragraph.text.length },
        selectedText: paragraph.text,
      },
    });
    const response = await app.inject({
      method: "GET",
      url: `/api/translations/${translated.json().translationId}/lexical-profile`,
    });

    expect(translated.statusCode).toBe(200);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "source_unavailable",
      profile: null,
      message: "当前无法连接网络，且本地没有可用的词汇资料缓存。",
    });
  });
});

describe("Translation 持久化与历史恢复", () => {
  it("复用相同 Fingerprint，并支持范围查询、历史读取和显式重试", async () => {
    let invocationCount = 0;
    const provider = createDefaultProvider();
    const countingProvider: ModelProvider = {
      ...provider,
      invoke: async (request) => {
        invocationCount += 1;
        return provider.invoke(request);
      },
    };
    const { app, database } = await createTestApp(countingProvider);
    const imported = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("translation-history.md"),
      },
      payload: Buffer.from("# Translation History\n\nContext matters in every reading."),
    });
    const documentId = imported.json().document.documentId;
    const revisionId = imported.json().document.activeRevisionId;
    const reader = await app.inject({ method: "GET", url: `/api/reader/documents/${documentId}` });
    const paragraph = reader.json().blocks[1];
    const payload = {
      revisionId,
      start: { blockId: paragraph.blockId, offset: 0 },
      end: { blockId: paragraph.blockId, offset: 7 },
      selectedText: "Context",
    };

    const first = await app.inject({
      method: "POST",
      url: `/api/reader/documents/${documentId}/translations`,
      payload,
    });
    const cached = await app.inject({
      method: "POST",
      url: `/api/reader/documents/${documentId}/translations`,
      payload,
    });

    expect(cached.json()).toEqual(first.json());
    expect(invocationCount).toBe(1);
    expect(database.connection.prepare("SELECT COUNT(*) AS count FROM operations").get())
      .toEqual({ count: 1 });
    const cachedOperation = await app.inject({
      method: "GET",
      url: `/api/operations/${first.json().operationId}`,
    });
    expect(cachedOperation.json()).toMatchObject({
      cacheHitCount: 1,
      invocations: [{ finishReason: null }],
    });
    expect(database.connection.prepare(`
      SELECT task_type, task_version, cache_key FROM runtime_cache_hits
    `).get()).toEqual({
      task_type: "selection.translation",
      task_version: "selection.translation.v1",
      cache_key: first.json().selection.fingerprint,
    });

    const ranges = await app.inject({
      method: "POST",
      url: `/api/reader/documents/${documentId}/translation-ranges`,
      payload: { revisionId, blockIds: [paragraph.blockId] },
    });
    expect(ranges.statusCode).toBe(200);
    expect(ranges.json().ranges).toEqual([
      expect.objectContaining({
        translationId: first.json().translationId,
        fingerprint: first.json().selection.fingerprint,
        selectedText: "Context",
      }),
    ]);

    const historical = await app.inject({
      method: "GET",
      url: `/api/translations/${first.json().translationId}`,
    });
    expect(historical.json()).toEqual(first.json());

    const retried = await app.inject({
      method: "POST",
      url: `/api/translations/${first.json().translationId}/retry`,
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json().translationId).not.toBe(first.json().translationId);
    expect(retried.json().selection.fingerprint).toBe(first.json().selection.fingerprint);
    expect(invocationCount).toBe(2);
    expect(database.connection.prepare(`
      SELECT previous_operation_id, cache_key, status FROM operations WHERE id = ?
    `).get(retried.json().operationId)).toEqual({
      previous_operation_id: first.json().operationId,
      cache_key: first.json().selection.fingerprint,
      status: "completed",
    });

    const latestRanges = await app.inject({
      method: "POST",
      url: `/api/reader/documents/${documentId}/translation-ranges`,
      payload: { revisionId, blockIds: [paragraph.blockId] },
    });
    expect(latestRanges.json().ranges).toEqual([
      expect.objectContaining({ translationId: retried.json().translationId }),
    ]);
  });

  it("取消信号传播到 Runtime，并持久化 Operation 与 Invocation 取消终态", async () => {
    const provider: ModelProvider = {
      providerId: "openai-compatible",
      modelId: "cancel-model",
      configured: true,
      baseUrl: "http://provider.test/v1",
      invoke: async (request) => new Promise((_, reject) => {
        request.signal?.addEventListener("abort", () => reject(new ApplicationError({
          code: "OPERATION_CANCELLED",
          message: "翻译操作已取消",
          statusCode: 499,
        })), { once: true });
      }),
    };
    const { app, database, translation } = await createTestApp(provider);
    const imported = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("translation-cancel.md"),
      },
      payload: Buffer.from("# Cancellation\n\nCancel this selection."),
    });
    const documentId = imported.json().document.documentId;
    const revisionId = imported.json().document.activeRevisionId;
    const reader = await app.inject({ method: "GET", url: `/api/reader/documents/${documentId}` });
    const paragraph = reader.json().blocks[1];
    const controller = new AbortController();
    const pending = translation.translate(documentId, {
      revisionId,
      start: { blockId: paragraph.blockId, offset: 0 },
      end: { blockId: paragraph.blockId, offset: 6 },
      selectedText: "Cancel",
    }, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "OPERATION_CANCELLED" });
    expect(database.connection.prepare("SELECT status, error_code FROM operations").get())
      .toEqual({ status: "cancelled", error_code: "OPERATION_CANCELLED" });
    expect(database.connection.prepare("SELECT status, error_code FROM invocations").get())
      .toEqual({ status: "cancelled", error_code: "OPERATION_CANCELLED" });
  });

  it("按 operationId 取消运行中的 Provider 调用", async () => {
    const provider: ModelProvider = {
      providerId: "openai-compatible",
      modelId: "operation-cancel-model",
      configured: true,
      baseUrl: "http://provider.test/v1",
      invoke: async (request) => new Promise((_, reject) => {
        request.signal?.addEventListener("abort", () => reject(new ApplicationError({
          code: "OPERATION_CANCELLED",
          message: "操作已取消",
          statusCode: 499,
        })), { once: true });
      }),
    };
    const { app, database, translation } = await createTestApp(provider);
    const imported = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("operation-cancel.md"),
      },
      payload: Buffer.from("# Cancellation\n\nCancel this operation."),
    });
    const documentId = imported.json().document.documentId;
    const revisionId = imported.json().document.activeRevisionId;
    const reader = await app.inject({ method: "GET", url: `/api/reader/documents/${documentId}` });
    const paragraph = reader.json().blocks[1];
    const pending = translation.translate(documentId, {
      revisionId,
      start: { blockId: paragraph.blockId, offset: 0 },
      end: { blockId: paragraph.blockId, offset: 6 },
      selectedText: "Cancel",
    });
    const operation = database.connection.prepare("SELECT id FROM operations").get() as { id: string };

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/api/operations/${operation.id}/cancel`,
    });

    expect(cancelResponse.statusCode).toBe(202);
    await expect(pending).rejects.toMatchObject({ code: "OPERATION_CANCELLED" });
    expect(database.connection.prepare("SELECT status FROM operations WHERE id = ?").get(operation.id))
      .toEqual({ status: "cancelled" });
  });
});

describe("Markdown 文档 API", () => {
  it("导入 Markdown 后可从文档库查询", async () => {
    const { app, database } = await createTestApp();

    const importResponse = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("The Little Prince.md"),
      },
      payload: Buffer.from("# The Little Prince\n\nIt is only with the heart that one can see rightly."),
    });

    expect(importResponse.statusCode).toBe(201);
    expect(importResponse.json()).toMatchObject({
      operation: { status: "completed", originalFilename: "The Little Prince.md" },
      document: { title: "The Little Prince", status: "ready", formatId: "markdown" },
    });

    const listResponse = await app.inject({ method: "GET", url: "/api/documents" });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().documents).toHaveLength(1);
    expect(listResponse.json().documents[0].originalFilename).toBe("The Little Prince.md");

    const readerResponse = await app.inject({
      method: "GET",
      url: `/api/reader/documents/${importResponse.json().document.documentId}`,
    });
    expect(readerResponse.statusCode).toBe(200);
    expect(readerResponse.json()).toMatchObject({
      renderHtml: expect.stringContaining("<h1"),
      blocks: [
        expect.objectContaining({ blockType: "heading", text: "The Little Prince" }),
        expect.objectContaining({
          blockType: "paragraph",
          text: "It is only with the heart that one can see rightly.",
        }),
      ],
      outline: [expect.objectContaining({ depth: 1, label: "The Little Prince" })],
      progress: null,
    });

    const firstBlock = readerResponse.json().blocks[0];
    const progressResponse = await app.inject({
      method: "PUT",
      url: `/api/reader/documents/${importResponse.json().document.documentId}/progress`,
      payload: {
        revisionId: importResponse.json().document.activeRevisionId,
        blockId: firstBlock.blockId,
        offset: 0,
        progression: 0.4,
      },
    });
    expect(progressResponse.statusCode).toBe(200);
    expect(progressResponse.json()).toMatchObject({ blockId: firstBlock.blockId, progression: 0.4 });

    const paragraph = readerResponse.json().blocks[1];
    const selectedText = "with the heart";
    const startOffset = paragraph.text.indexOf(selectedText);
    const translationResponse = await app.inject({
      method: "POST",
      url: `/api/reader/documents/${importResponse.json().document.documentId}/translations`,
      payload: {
        revisionId: importResponse.json().document.activeRevisionId,
        start: { blockId: paragraph.blockId, offset: startOffset },
        end: { blockId: paragraph.blockId, offset: startOffset + selectedText.length },
        selectedText,
      },
    });
    expect(translationResponse.statusCode).toBe(200);
    expect(translationResponse.json()).toMatchObject({
      selection: {
        selectedText,
        start: { blockId: paragraph.blockId, offset: startOffset },
        sourceRanges: [{
          blockId: paragraph.blockId,
          semanticStartOffset: startOffset,
          semanticEndOffset: startOffset + selectedText.length,
          source: { kind: "markdown-offset" },
        }],
      },
      contextualTranslation: "只有用心才能看得清楚。",
      expressionType: "sentence",
    });
    const translationOperationResponse = await app.inject({
      method: "GET",
      url: `/api/operations/${translationResponse.json().operationId}`,
    });
    expect(translationOperationResponse.statusCode).toBe(200);
    expect(translationOperationResponse.json()).toMatchObject({
      operationId: translationResponse.json().operationId,
      taskType: "selection.translation",
      status: "completed",
      latestSequence: 6,
      invocations: [{ attemptNumber: 1, status: "succeeded", providerId: "openai-compatible" }],
    });
    expect(database.connection.prepare(`
      SELECT sequence, event_type FROM operation_events
      WHERE operation_id = ? ORDER BY sequence
    `).all(translationResponse.json().operationId)).toEqual([
      { sequence: 1, event_type: "operation.requested" },
      { sequence: 2, event_type: "operation.running" },
      { sequence: 3, event_type: "task.compiled" },
      { sequence: 4, event_type: "invocation.running" },
      { sequence: 5, event_type: "invocation.succeeded" },
      { sequence: 6, event_type: "operation.completed" },
    ]);

    const annotationResponse = await app.inject({
      method: "POST",
      url: `/api/reader/documents/${importResponse.json().document.documentId}/annotations`,
      payload: {
        revisionId: importResponse.json().document.activeRevisionId,
        start: { blockId: paragraph.blockId, offset: startOffset },
        end: { blockId: paragraph.blockId, offset: startOffset + selectedText.length },
        selectedText,
        note: "第一次标注",
        source: {
          type: "translation",
          translationId: translationResponse.json().translationId,
        },
      },
    });
    expect(annotationResponse.statusCode).toBe(201);
    expect(annotationResponse.json()).toMatchObject({
      selectedText,
      note: "第一次标注",
      source: { type: "translation", translationId: translationResponse.json().translationId },
      status: "active",
    });
    const annotationId = annotationResponse.json().annotationId;
    const annotationList = await app.inject({
      method: "POST",
      url: `/api/reader/documents/${importResponse.json().document.documentId}/annotations/query`,
      payload: {
        revisionId: importResponse.json().document.activeRevisionId,
        blockIds: [paragraph.blockId],
      },
    });
    expect(annotationList.json().annotations).toEqual([
      expect.objectContaining({ annotationId, selectedText }),
    ]);
    const updatedAnnotation = await app.inject({
      method: "PATCH",
      url: `/api/annotations/${annotationId}`,
      payload: { note: "更新后的标注笔记" },
    });
    expect(updatedAnnotation.json().note).toBe("更新后的标注笔记");
    const archivedAnnotation = await app.inject({
      method: "POST",
      url: `/api/annotations/${annotationId}/archive`,
    });
    expect(archivedAnnotation.json().status).toBe("archived");
    expect(database.connection.prepare(
      "SELECT COUNT(*) AS count FROM translations WHERE id = ?",
    ).get(translationResponse.json().translationId)).toEqual({ count: 1 });

    const saveResponse = await app.inject({
      method: "POST",
      url: "/api/learning-items",
      payload: { translationId: translationResponse.json().translationId },
    });
    expect(saveResponse.statusCode).toBe(201);
    expect(saveResponse.json()).toMatchObject({
      canonicalForm: selectedText,
      status: "active",
      contexts: [
        expect.objectContaining({
          surfaceForm: selectedText,
          contextualTranslation: "只有用心才能看得清楚。",
        }),
      ],
    });

    const duplicateSaveResponse = await app.inject({
      method: "POST",
      url: "/api/learning-items",
      payload: { translationId: translationResponse.json().translationId },
    });
    expect(duplicateSaveResponse.json().contexts).toHaveLength(1);

    const learningList = await app.inject({ method: "GET", url: "/api/learning-items" });
    expect(learningList.json().items).toHaveLength(1);

    const secondImport = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("Second Encounter.md"),
      },
      payload: Buffer.from("# Second Encounter\n\nShe learned to see WITH THE HEART, not only with her eyes."),
    });
    const secondReader = await app.inject({
      method: "GET",
      url: `/api/reader/documents/${secondImport.json().document.documentId}`,
    });
    const secondParagraph = secondReader.json().blocks[1];

    const matchesResponse = await app.inject({
      method: "POST",
      url: `/api/reader/documents/${secondImport.json().document.documentId}/recall-matches`,
      payload: {
        revisionId: secondImport.json().document.activeRevisionId,
        blockIds: [secondParagraph.blockId],
      },
    });
    expect(matchesResponse.json().matches).toEqual([
      expect.objectContaining({
        surfaceForm: "WITH THE HEART",
        blockId: secondParagraph.blockId,
        matchType: "case_insensitive",
      }),
    ]);

    const occurrenceResponse = await app.inject({
      method: "POST",
      url: "/api/recall-occurrences",
      payload: {
        revisionId: secondImport.json().document.activeRevisionId,
        match: matchesResponse.json().matches[0],
      },
    });
    expect(occurrenceResponse.statusCode).toBe(201);
    expect(occurrenceResponse.json()).toMatchObject({ surfaceForm: "WITH THE HEART" });

    const evaluationResponse = await app.inject({
      method: "POST",
      url: `/api/recall-occurrences/${occurrenceResponse.json().occurrenceId}/evaluation`,
      payload: { userInterpretation: "要用内心体会，而不是只看表面。" },
    });
    expect(evaluationResponse.statusCode).toBe(200);
    expect(evaluationResponse.json()).toMatchObject({
      verdict: "understood",
      feedback: "你的理解符合当前语境。",
    });
    expect(database.connection.prepare("SELECT status FROM operations ORDER BY created_at").all())
      .toEqual([{ status: "completed" }, { status: "completed" }]);
    expect(database.connection.prepare("SELECT status FROM invocations ORDER BY started_at").all())
      .toEqual([{ status: "succeeded" }, { status: "succeeded" }]);

    const expressionId = saveResponse.json().expressionId;
    const contextId = saveResponse.json().contexts[0].learningContextId;
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/learning-items/${expressionId}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      expressionId,
      contexts: [
        expect.objectContaining({
          learningContextId: contextId,
          documentTitle: "The Little Prince",
          locationLabel: "The Little Prince",
          explanation: translationResponse.json().explanation,
          status: "active",
        }),
      ],
    });

    const expressionNoteResponse = await app.inject({
      method: "PATCH",
      url: `/api/learning-items/${expressionId}/note`,
      payload: { note: "关注 heart 的隐喻用法" },
    });
    expect(expressionNoteResponse.json().userNote).toBe("关注 heart 的隐喻用法");

    const contextNoteResponse = await app.inject({
      method: "PATCH",
      url: `/api/learning-items/${expressionId}/contexts/${contextId}/note`,
      payload: { note: "第一次阅读时的关键句" },
    });
    expect(contextNoteResponse.json().contexts[0].userNote).toBe("第一次阅读时的关键句");

    const statusResponse = await app.inject({
      method: "PATCH",
      url: `/api/learning-items/${expressionId}/status`,
      payload: { status: "familiar" },
    });
    expect(statusResponse.json().status).toBe("familiar");
    expect(database.connection.prepare(
      "SELECT previous_status, next_status FROM expression_status_history WHERE expression_id = ?",
    ).get(expressionId)).toEqual({ previous_status: "active", next_status: "familiar" });

    const searchedList = await app.inject({
      method: "GET",
      url: `/api/learning-items?query=${encodeURIComponent("隐喻")}&status=familiar&sourceDocumentId=${importResponse.json().document.documentId}`,
    });
    expect(searchedList.statusCode).toBe(200);
    expect(searchedList.json()).toMatchObject({
      totalExpressions: 1,
      totalContexts: 1,
      items: [expect.objectContaining({ expressionId, contextCount: 1, status: "familiar" })],
    });

    const translationCountBeforeArchive = database.connection.prepare(
      "SELECT COUNT(*) AS count FROM translations",
    ).get();
    const operationCountBeforeArchive = database.connection.prepare(
      "SELECT COUNT(*) AS count FROM operations",
    ).get();
    const archiveResponse = await app.inject({
      method: "POST",
      url: `/api/learning-items/${expressionId}/contexts/${contextId}/archive`,
    });
    expect(archiveResponse.statusCode).toBe(200);
    expect(archiveResponse.json().contexts[0].status).toBe("archived");
    expect(database.connection.prepare("SELECT COUNT(*) AS count FROM translations").get())
      .toEqual(translationCountBeforeArchive);
    expect(database.connection.prepare("SELECT COUNT(*) AS count FROM operations").get())
      .toEqual(operationCountBeforeArchive);
    const archiveExpressionResponse = await app.inject({
      method: "PATCH",
      url: `/api/learning-items/${expressionId}/status`,
      payload: { status: "archived" },
    });
    expect(archiveExpressionResponse.json().status).toBe("archived");
    const restoredSave = await app.inject({
      method: "POST",
      url: "/api/learning-items",
      payload: { translationId: translationResponse.json().translationId },
    });
    expect(restoredSave.statusCode).toBe(201);
    expect(restoredSave.json()).toMatchObject({
      expressionId,
      status: "active",
      contexts: [expect.objectContaining({ learningContextId: contextId })],
    });
    expect(database.connection.prepare(
      "SELECT status FROM learning_contexts WHERE id = ?",
    ).get(contextId)).toEqual({ status: "active" });
  });

  it("通过文档 Revision API 更新当前版本并保留旧投影", async () => {
    const { app, database } = await createTestApp();
    const imported = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("Revision.md"),
      },
      payload: Buffer.from("# Revision\n\nOriginal body."),
    });
    const documentId = imported.json().document.documentId;
    const originalRevisionId = imported.json().document.activeRevisionId;

    const updated = await app.inject({
      method: "POST",
      url: `/api/documents/${documentId}/revisions`,
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("Revision.md"),
      },
      payload: Buffer.from("# Revision\n\nUpdated body."),
    });

    expect(updated.statusCode).toBe(201);
    expect(updated.json()).toMatchObject({
      operation: { kind: "revision_update", status: "completed", documentId },
      document: { documentId },
    });
    expect(updated.json().document.activeRevisionId).not.toBe(originalRevisionId);
    const reader = await app.inject({ method: "GET", url: `/api/reader/documents/${documentId}` });
    expect(reader.json().blocks).toEqual([
      expect.objectContaining({ text: "Revision" }),
      expect.objectContaining({ text: "Updated body." }),
    ]);
    const historicalReader = await app.inject({
      method: "GET",
      url: `/api/reader/documents/${documentId}?revisionId=${originalRevisionId}`,
    });
    expect(historicalReader.statusCode).toBe(200);
    expect(historicalReader.json()).toMatchObject({
      revision: { revisionId: originalRevisionId },
      progress: null,
      blocks: [
        expect.objectContaining({ text: "Revision" }),
        expect.objectContaining({ text: "Original body." }),
      ],
    });
    expect(database.connection.prepare(`
      SELECT text FROM semantic_blocks WHERE revision_id = ? ORDER BY block_order
    `).all(originalRevisionId)).toEqual([
      { text: "Revision" },
      { text: "Original body." },
    ]);
  });

  it("通过受控 Resource API 读取完整来源和显式字节范围", async () => {
    const { app } = await createTestApp();
    const source = "# Resource\n\nRange body.";
    const imported = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("Resource.md"),
      },
      payload: Buffer.from(source),
    });
    const detail = await app.inject({
      method: "GET",
      url: `/api/documents/${imported.json().document.documentId}`,
    });
    const resourceId = detail.json().sourceResourceId;

    const full = await app.inject({ method: "GET", url: `/api/resources/${resourceId}` });
    expect(full.statusCode).toBe(200);
    expect(full.body).toBe(source);
    expect(full.headers).toMatchObject({
      "accept-ranges": "bytes",
      "content-type": "text/markdown",
      "x-content-type-options": "nosniff",
    });

    const partial = await app.inject({
      method: "GET",
      url: `/api/resources/${resourceId}`,
      headers: { range: "bytes=2-9" },
    });
    expect(partial.statusCode).toBe(206);
    expect(partial.body).toBe("Resource");
    expect(partial.headers["content-range"]).toBe(`bytes 2-9/${Buffer.byteLength(source)}`);

    const invalidRange = await app.inject({
      method: "GET",
      url: `/api/resources/${resourceId}`,
      headers: { range: "bytes=999-1000" },
    });
    expect(invalidRange.statusCode).toBe(416);
    expect(invalidRange.json()).toMatchObject({ code: "RESOURCE_RANGE_INVALID" });

    const pathLikeId = await app.inject({
      method: "GET",
      url: "/api/resources/..%2F..%2Flumen.db",
    });
    expect(pathLikeId.statusCode).toBe(404);
    expect(pathLikeId.json()).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("支持 Source Mapping 从语义位置到来源位置的双向查询", async () => {
    const { app } = await createTestApp();
    const imported = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("Mapping.md"),
      },
      payload: Buffer.from("# Mapping\n\nSemantic body."),
    });
    const revisionId = imported.json().document.activeRevisionId;
    const reader = await app.inject({
      method: "GET",
      url: `/api/reader/documents/${imported.json().document.documentId}`,
    });
    const paragraph = reader.json().blocks[1];

    const fromSemantic = await app.inject({
      method: "POST",
      url: `/api/revisions/${revisionId}/source-mappings/by-semantic-point`,
      payload: { blockId: paragraph.blockId, offset: 3 },
    });
    expect(fromSemantic.statusCode).toBe(200);
    const mapping = fromSemantic.json().mappings[0];
    expect(mapping).toMatchObject({
      revisionId,
      blockId: paragraph.blockId,
      mappingKind: "markdown_offset",
      semanticStartOffset: 0,
      semanticEndOffset: paragraph.text.length,
    });

    const fromSource = await app.inject({
      method: "POST",
      url: `/api/revisions/${revisionId}/source-mappings/by-source-offset`,
      payload: { sourceOffset: mapping.sourceStartOffset },
    });
    expect(fromSource.statusCode).toBe(200);
    expect(fromSource.json().mappings).toContainEqual(mapping);

    const missing = await app.inject({
      method: "POST",
      url: `/api/revisions/${revisionId}/source-mappings/by-source-offset`,
      payload: { sourceOffset: 9999 },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "SOURCE_MAPPING_NOT_FOUND" });
  });

  it("Reader 打开时安全重建过期的 Render Projection", async () => {
    const { app, database } = await createTestApp();
    const imported = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("Rebuild.md"),
      },
      payload: Buffer.from("# Rebuild\n\nStable semantic content."),
    });
    const revisionId = imported.json().document.activeRevisionId;
    database.connection.prepare(`
      UPDATE document_revisions
      SET adapter_version = 'markdown.adapter.legacy',
        render_projection_version = 'markdown.render.legacy'
      WHERE id = ?
    `).run(revisionId);
    database.connection.prepare(`
      UPDATE document_projections SET render_html = '<p>stale</p>' WHERE revision_id = ?
    `).run(revisionId);

    const reader = await app.inject({
      method: "GET",
      url: `/api/reader/documents/${imported.json().document.documentId}`,
    });

    expect(reader.statusCode).toBe(200);
    expect(reader.json()).toMatchObject({
      revision: {
        revisionId,
        format: {
          adapterVersion: "markdown.adapter.v1",
          renderProjectionVersion: "markdown.render.v1",
        },
      },
      renderHtml: expect.stringContaining("Stable semantic content."),
    });
    expect(database.connection.prepare(`
      SELECT render_html FROM document_projections WHERE revision_id = ?
    `).get(revisionId)).toEqual({ render_html: reader.json().renderHtml });
  });

  it("Reader 拒绝原地重建会改变稳定身份的语义投影", async () => {
    const { app, database } = await createTestApp();
    const imported = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("Semantic.md"),
      },
      payload: Buffer.from("# Semantic\n\nStable identity."),
    });
    const revisionId = imported.json().document.activeRevisionId;
    database.connection.prepare(`
      UPDATE document_revisions SET semantic_projection_version = 'markdown.semantic.legacy'
      WHERE id = ?
    `).run(revisionId);

    const reader = await app.inject({
      method: "GET",
      url: `/api/reader/documents/${imported.json().document.documentId}`,
    });

    expect(reader.statusCode).toBe(409);
    expect(reader.json()).toMatchObject({ code: "DOCUMENT_REVISION_UPDATE_REQUIRED" });
    expect(database.connection.prepare(`
      SELECT semantic_projection_version FROM document_revisions WHERE id = ?
    `).get(revisionId)).toEqual({ semantic_projection_version: "markdown.semantic.legacy" });
  });

  it("拒绝非 Markdown 文件并返回统一错误结构", async () => {
    const { app } = await createTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("notes.txt"),
      },
      payload: Buffer.from("plain text"),
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({
      code: "DOCUMENT_FORMAT_UNSUPPORTED",
      retryable: false,
    });
    expect(response.json().traceId).toEqual(expect.any(String));
  });

  it("查询不存在的 Operation 返回稳定错误码", async () => {
    const { app } = await createTestApp();
    const response = await app.inject({ method: "GET", url: "/api/operations/not-found" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "OPERATION_NOT_FOUND" });
  });

  it("无效 UTF-8 导入不会产生可见文档，并保留失败任务", async () => {
    const { app } = await createTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("broken.md"),
      },
      payload: Buffer.from([0xc3, 0x28]),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "DOCUMENT_SOURCE_INVALID",
      operationId: expect.any(String),
    });

    const operationResponse = await app.inject({
      method: "GET",
      url: `/api/imports/${response.json().operationId}`,
    });
    expect(operationResponse.json()).toMatchObject({
      status: "failed",
      errorCode: "DOCUMENT_SOURCE_INVALID",
      documentId: null,
    });

    const listResponse = await app.inject({ method: "GET", url: "/api/documents" });
    expect(listResponse.json()).toEqual({ documents: [] });
  });

  it("拒绝无法由服务端重建的 Selection，不创建 AI Operation", async () => {
    const { app, database } = await createTestApp();
    const imported = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("selection.md"),
      },
      payload: Buffer.from("# Selection\n\nA reliable semantic selection."),
    });
    const reader = await app.inject({
      method: "GET",
      url: `/api/reader/documents/${imported.json().document.documentId}`,
    });
    const paragraph = reader.json().blocks[1];
    const response = await app.inject({
      method: "POST",
      url: `/api/reader/documents/${imported.json().document.documentId}/translations`,
      payload: {
        revisionId: imported.json().document.activeRevisionId,
        start: { blockId: paragraph.blockId, offset: 2 },
        end: { blockId: paragraph.blockId, offset: 10 },
        selectedText: "tampered",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "SELECTION_INVALID" });
    expect(database.connection.prepare("SELECT COUNT(*) AS count FROM operations").get())
      .toEqual({ count: 0 });
  });

  it("支持跨语义块 Selection 并拒绝切断 UTF-16 代理项", async () => {
    const { app, database } = await createTestApp();
    const imported = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("cross-block.md"),
      },
      payload: Buffer.from("# Cross Block\n\nAlpha end.\n\nBeta 😀 start."),
    });
    const reader = await app.inject({
      method: "GET",
      url: `/api/reader/documents/${imported.json().document.documentId}`,
    });
    const firstParagraph = reader.json().blocks[1];
    const secondParagraph = reader.json().blocks[2];
    const response = await app.inject({
      method: "POST",
      url: `/api/reader/documents/${imported.json().document.documentId}/translations`,
      payload: {
        revisionId: imported.json().document.activeRevisionId,
        start: { blockId: firstParagraph.blockId, offset: 6 },
        end: { blockId: secondParagraph.blockId, offset: 4 },
        selectedText: "end.\n\nBeta",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().selection).toMatchObject({
      selectedText: "end.\n\nBeta",
      sourceRanges: [
        {
          blockId: firstParagraph.blockId,
          semanticStartOffset: 6,
          semanticEndOffset: firstParagraph.text.length,
        },
        {
          blockId: secondParagraph.blockId,
          semanticStartOffset: 0,
          semanticEndOffset: 4,
        },
      ],
    });

    const surrogateResponse = await app.inject({
      method: "POST",
      url: `/api/reader/documents/${imported.json().document.documentId}/translations`,
      payload: {
        revisionId: imported.json().document.activeRevisionId,
        start: { blockId: secondParagraph.blockId, offset: 6 },
        end: { blockId: secondParagraph.blockId, offset: 8 },
        selectedText: "\ude00 ",
      },
    });
    expect(surrogateResponse.statusCode).toBe(409);
    expect(surrogateResponse.json()).toMatchObject({ code: "SELECTION_INVALID" });
    expect(database.connection.prepare("SELECT COUNT(*) AS count FROM operations").get())
      .toEqual({ count: 1 });
  });

  it("模型输出非法时有限修复并记录同一 Operation 的多次 Invocation", async () => {
    const invalidProvider: ModelProvider = {
      providerId: "openai-compatible",
      modelId: "invalid-output-model",
      configured: true,
      baseUrl: "http://provider.test/v1",
      invoke: async () => ({ content: "not-json", inputTokens: 5, outputTokens: 2 }),
    };
    const { app, database } = await createTestApp(invalidProvider);
    const imported = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("invalid-output.md"),
      },
      payload: Buffer.from("# Invalid Output\n\nContext matters."),
    });
    const reader = await app.inject({
      method: "GET",
      url: `/api/reader/documents/${imported.json().document.documentId}`,
    });
    const paragraph = reader.json().blocks[1];
    const response = await app.inject({
      method: "POST",
      url: `/api/reader/documents/${imported.json().document.documentId}/translations`,
      payload: {
        revisionId: imported.json().document.activeRevisionId,
        start: { blockId: paragraph.blockId, offset: 0 },
        end: { blockId: paragraph.blockId, offset: 7 },
        selectedText: "Context",
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      code: "MODEL_OUTPUT_INVALID",
      operationId: expect.any(String),
    });
    expect(database.connection.prepare("SELECT status, error_code FROM operations").get())
      .toEqual({ status: "failed", error_code: "MODEL_OUTPUT_INVALID" });
    expect(database.connection.prepare(`
      SELECT attempt_number, status, error_code FROM invocations ORDER BY attempt_number
    `).all()).toEqual([
      { attempt_number: 1, status: "failed", error_code: "MODEL_OUTPUT_INVALID" },
      { attempt_number: 2, status: "failed", error_code: "MODEL_OUTPUT_INVALID" },
    ]);
    const eventsResponse = await app.inject({
      method: "GET",
      url: `/api/operations/${response.json().operationId}/events?after=2`,
    });
    expect(eventsResponse.statusCode).toBe(200);
    expect(eventsResponse.json().events.map((event: { sequence: number }) => event.sequence))
      .toEqual([3, 4, 5, 6, 7, 8]);
    expect(eventsResponse.json().events[0]).toMatchObject({
      sequence: 3,
      eventType: "task.compiled",
      payload: { compilerVersion: "context-compiler.v1" },
    });
    const streamResponse = await app.inject({
      method: "GET",
      url: `/api/operations/${response.json().operationId}/events/stream?after=5`,
    });
    expect(streamResponse.statusCode).toBe(200);
    expect(streamResponse.headers["content-type"]).toContain("text/event-stream");
    expect(streamResponse.body).toContain("id: 7\ndata:");
    expect(streamResponse.body).toContain('"eventType":"invocation.failed"');
    expect(streamResponse.body).toContain("id: 8\ndata:");
    expect(streamResponse.body).toContain('"eventType":"operation.failed"');
    expect(database.connection.prepare("SELECT COUNT(*) AS count FROM translations").get())
      .toEqual({ count: 0 });
  });
});

describe("Contextual AI Workspace", () => {
  it("校验六类 Reference、执行受控多轮回答并恢复持久化 Session", async () => {
    const defaultProvider = createDefaultProvider();
    const workspaceInputs: Array<{
      references: Array<{ referenceId: string; type: string }>;
      conversation: Array<{ question: string; answer: string }>;
    }> = [];
    const provider: ModelProvider = {
      ...defaultProvider,
      invoke: async (request) => {
        if (!request.systemPrompt.includes("受控阅读上下文助手")) {
          return defaultProvider.invoke(request);
        }
        const input = JSON.parse(request.userPrompt) as {
          references: Array<{ referenceId: string; type: string }>;
          conversation: Array<{ question: string; answer: string }>;
        };
        workspaceInputs.push(input);
        return {
          content: JSON.stringify({
            content: `已根据 ${input.references.length} 条显式引用回答。`,
            citationReferenceIds: input.references.map((reference) => reference.referenceId),
          }),
          inputTokens: 40,
          outputTokens: 20,
        };
      },
    };
    const { app, database } = await createTestApp(provider);
    const imported = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("workspace.md"),
      },
      payload: Buffer.from("# Workspace\n\nContext matters in every careful reading."),
    });
    const documentId = imported.json().document.documentId;
    const revisionId = imported.json().document.activeRevisionId;
    const reader = await app.inject({ method: "GET", url: `/api/reader/documents/${documentId}` });
    const paragraph = reader.json().blocks[1];
    const selection = {
      revisionId,
      start: { blockId: paragraph.blockId, offset: 0 },
      end: { blockId: paragraph.blockId, offset: 7 },
      selectedText: "Context",
    };
    const translation = await app.inject({
      method: "POST",
      url: `/api/reader/documents/${documentId}/translations`,
      payload: selection,
    });
    const learning = await app.inject({
      method: "POST",
      url: "/api/learning-items",
      payload: { translationId: translation.json().translationId },
    });
    const annotation = await app.inject({
      method: "POST",
      url: `/api/reader/documents/${documentId}/annotations`,
      payload: {
        ...selection,
        note: "这里需要结合上下文。",
        source: { type: "translation", translationId: translation.json().translationId },
      },
    });
    const opened = await app.inject({
      method: "POST",
      url: `/api/reader/documents/${documentId}/workspace`,
      payload: { revisionId },
    });
    expect(opened.statusCode).toBe(200);
    const sessionId = opened.json().sessionId;
    const reopened = await app.inject({
      method: "POST",
      url: `/api/reader/documents/${documentId}/workspace`,
      payload: { revisionId },
    });
    expect(reopened.json().sessionId).toBe(sessionId);

    const firstTurn = await app.inject({
      method: "POST",
      url: `/api/workspaces/${sessionId}/turns`,
      payload: {
        question: "这些材料共同说明了什么？",
        references: [
          {
            type: "selection",
            start: selection.start,
            end: selection.end,
            selectedText: selection.selectedText,
          },
          { type: "paragraph", targetId: paragraph.blockId },
          { type: "translation", targetId: translation.json().translationId },
          { type: "learning_context", targetId: learning.json().contexts[0].learningContextId },
          { type: "annotation", targetId: annotation.json().annotationId },
        ],
      },
    });
    expect(firstTurn.statusCode).toBe(200);
    expect(firstTurn.json().references.map((reference: { type: string }) => reference.type))
      .toEqual(["selection", "paragraph", "translation", "learning_context", "annotation"]);
    expect(firstTurn.json().answer.citationReferenceIds)
      .toEqual(firstTurn.json().references.map((reference: { referenceId: string }) => reference.referenceId));

    const secondTurn = await app.inject({
      method: "POST",
      url: `/api/workspaces/${sessionId}/turns`,
      payload: {
        question: "上一轮回答的重点是什么？",
        references: [{ type: "workspace_turn", targetId: firstTurn.json().turnId }],
      },
    });
    expect(secondTurn.statusCode).toBe(200);
    expect(workspaceInputs[1]?.conversation).toEqual([{
      question: "这些材料共同说明了什么？",
      answer: "已根据 5 条显式引用回答。",
    }]);
    expect(secondTurn.json().references[0]).toMatchObject({ type: "workspace_turn" });

    const restored = await app.inject({ method: "GET", url: `/api/workspaces/${sessionId}` });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().turns).toHaveLength(2);
    expect(database.connection.prepare(`
      SELECT status, task_type, task_version FROM operations
      WHERE task_type = 'workspace.answer' ORDER BY created_at
    `).all()).toEqual([
      { status: "completed", task_type: "workspace.answer", task_version: "workspace.answer.v1" },
      { status: "completed", task_type: "workspace.answer", task_version: "workspace.answer.v1" },
    ]);

    const otherImported = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        "content-type": "application/octet-stream",
        "x-lumen-filename": encodeURIComponent("other-workspace.md"),
      },
      payload: Buffer.from("# Other\n\nThis paragraph belongs elsewhere."),
    });
    const otherReader = await app.inject({
      method: "GET",
      url: `/api/reader/documents/${otherImported.json().document.documentId}`,
    });
    const invalid = await app.inject({
      method: "POST",
      url: `/api/workspaces/${sessionId}/turns`,
      payload: {
        question: "能读取另一个文档吗？",
        references: [{ type: "paragraph", targetId: otherReader.json().blocks[1].blockId }],
      },
    });
    expect(invalid.statusCode).toBe(409);
    expect(invalid.json()).toMatchObject({ code: "WORKSPACE_REFERENCE_INVALID" });
    expect(database.connection.prepare(
      "SELECT COUNT(*) AS count FROM operations WHERE task_type = 'workspace.answer'",
    ).get()).toEqual({ count: 2 });
  });
});
