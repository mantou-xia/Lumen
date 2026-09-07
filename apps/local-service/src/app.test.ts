import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { ControlledTaskRuntime } from "./agent-runtime/controlled-task-runtime.js";
import type { ModelProvider } from "./agent-runtime/model-provider.js";
import { LibraryApplication } from "./application/library.js";
import { ReaderApplication } from "./application/reader.js";
import { TranslationApplication } from "./application/translation.js";
import { LearningApplication } from "./application/learning.js";
import { RecallApplication } from "./application/recall.js";
import { openDatabase } from "./infrastructure/database/database.js";
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
      content: request.systemPrompt.includes("回忆判断")
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

async function createTestApp(provider: ModelProvider = createDefaultProvider()) {
  const directory = mkdtempSync(join(tmpdir(), "lumen-local-service-"));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, "lumen.db"));
  const fileStore = new ManagedFileStore(directory);
  await fileStore.initialize();
  const library = new LibraryApplication(database, fileStore);
  const reader = new ReaderApplication(database);
  const runtime = new ControlledTaskRuntime(provider, new RuntimeRepository(database.connection));
  const translation = new TranslationApplication(database, runtime);
  const learning = new LearningApplication(database);
  const recall = new RecallApplication(database, runtime);
  const app = buildApp({ database, library, reader, translation, learning, recall });
  closeCallbacks.push(() => database.close(), () => app.close());
  return { app, database };
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
        schemaVersion: 6,
      },
    });
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
      selection: { selectedText, start: { blockId: paragraph.blockId, offset: startOffset } },
      contextualTranslation: "只有用心才能看得清楚。",
      expressionType: "sentence",
    });

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

  it("模型输出非法时记录失败的 Operation 与 Invocation", async () => {
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
    expect(database.connection.prepare("SELECT status, error_code FROM invocations").get())
      .toEqual({ status: "failed", error_code: "MODEL_OUTPUT_INVALID" });
    expect(database.connection.prepare("SELECT COUNT(*) AS count FROM translations").get())
      .toEqual({ count: 0 });
  });
});
