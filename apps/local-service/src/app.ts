import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import {
  applicationErrorSchema,
  healthResponseSchema,
  importDocumentResponseSchema,
  importOperationSchema,
  documentListResponseSchema,
  readerDocumentSchema,
  readingProgressSchema,
  updateReadingProgressRequestSchema,
  providerStatusSchema,
  translateSelectionRequestSchema,
  translationResultSchema,
  learningItemListSchema,
  learningItemSchema,
  saveLearningItemRequestSchema,
  evaluateRecallRequestSchema,
  openRecallRequestSchema,
  recallEvaluationSchema,
  recallMatchListSchema,
  recallMatchesRequestSchema,
  recallOccurrenceSchema,
} from "@lumen/api-contract";
import Fastify, { type FastifyInstance } from "fastify";

import { ApplicationError } from "./application/errors.js";
import type { LibraryApplication } from "./application/library.js";
import type { ReaderApplication } from "./application/reader.js";
import type { TranslationApplication } from "./application/translation.js";
import type { LearningApplication } from "./application/learning.js";
import type { RecallApplication } from "./application/recall.js";
import type { LumenDatabase } from "./infrastructure/database/database.js";

export interface LocalServiceDependencies {
  database: LumenDatabase;
  library: LibraryApplication;
  reader: ReaderApplication;
  translation: TranslationApplication;
  learning: LearningApplication;
  recall: RecallApplication;
  logger?: boolean;
}

function readFilenameHeader(value: string | string[] | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ApplicationError({
      code: "DOCUMENT_SOURCE_INVALID",
      message: "缺少 x-lumen-filename 请求头",
      statusCode: 400,
    });
  }

  try {
    return decodeURIComponent(value);
  } catch (error) {
    throw new ApplicationError({
      code: "DOCUMENT_SOURCE_INVALID",
      message: "x-lumen-filename 不是有效的 URI 编码文件名",
      statusCode: 400,
      cause: error,
    });
  }
}

export function buildApp(dependencies: LocalServiceDependencies): FastifyInstance {
  const app = Fastify({ logger: dependencies.logger ?? false });

  app.addContentTypeParser(
    ["application/octet-stream", "text/markdown"],
    (_request, payload, done) => {
      done(null, payload);
    },
  );

  app.setErrorHandler((error, request, reply) => {
    const traceId = request.id ?? randomUUID();
    const applicationError =
      error instanceof ApplicationError
        ? error
        : new ApplicationError({
            code: "INTERNAL_ERROR",
            message: "Local Service 处理请求时发生内部错误",
            retryable: true,
            statusCode: 500,
            cause: error,
          });

    if (!(error instanceof ApplicationError)) {
      request.log.error(error);
    }

    void reply.status(applicationError.statusCode).send(
      applicationErrorSchema.parse({
        code: applicationError.code,
        message: applicationError.message,
        retryable: applicationError.retryable,
        operationId: applicationError.operationId,
        traceId,
      }),
    );
  });

  app.get("/api/health", async () =>
    healthResponseSchema.parse({
      status: "ok",
      service: "lumen-local-service",
      version: "0.1.0",
      database: {
        status: "ready",
        schemaVersion: dependencies.database.schemaVersion,
      },
    }),
  );

  app.get("/api/documents", async () =>
    documentListResponseSchema.parse({ documents: dependencies.library.listDocuments() }),
  );

  app.get<{ Params: { documentId: string } }>("/api/documents/:documentId", async (request) =>
    dependencies.library.getDocument(request.params.documentId),
  );

  app.get<{ Params: { operationId: string } }>("/api/imports/:operationId", async (request) =>
    importOperationSchema.parse(dependencies.library.getImportOperation(request.params.operationId)),
  );

  app.post("/api/imports", async (request, reply) => {
    if (!(request.body instanceof Readable)) {
      throw new ApplicationError({
        code: "DOCUMENT_SOURCE_INVALID",
        message: "导入请求必须包含 Markdown 文件内容",
        statusCode: 400,
      });
    }

    const response = await dependencies.library.importMarkdown(
      readFilenameHeader(request.headers["x-lumen-filename"]),
      request.body,
    );
    return reply.status(201).send(importDocumentResponseSchema.parse(response));
  });

  app.get<{ Params: { documentId: string } }>(
    "/api/reader/documents/:documentId",
    async (request) =>
      readerDocumentSchema.parse(dependencies.reader.openDocument(request.params.documentId)),
  );

  app.put<{ Params: { documentId: string } }>(
    "/api/reader/documents/:documentId/progress",
    async (request) =>
      readingProgressSchema.parse(
        dependencies.reader.updateProgress(
          request.params.documentId,
          updateReadingProgressRequestSchema.parse(request.body),
        ),
      ),
  );

  app.get("/api/settings/provider-status", async () =>
    providerStatusSchema.parse(dependencies.translation.providerStatus()),
  );

  app.post<{ Params: { documentId: string } }>(
    "/api/reader/documents/:documentId/translations",
    async (request) =>
      translationResultSchema.parse(
        await dependencies.translation.translate(
          request.params.documentId,
          translateSelectionRequestSchema.parse(request.body),
        ),
      ),
  );

  app.post("/api/learning-items", async (request, reply) => {
    const input = saveLearningItemRequestSchema.parse(request.body);
    return reply.status(201).send(
      learningItemSchema.parse(dependencies.learning.saveFromTranslation(input.translationId)),
    );
  });

  app.get("/api/learning-items", async () =>
    learningItemListSchema.parse({ items: dependencies.learning.listItems() }),
  );

  app.post<{ Params: { documentId: string } }>(
    "/api/reader/documents/:documentId/recall-matches",
    async (request) => recallMatchListSchema.parse({
      matches: dependencies.recall.findMatches(
        request.params.documentId,
        recallMatchesRequestSchema.parse(request.body),
      ),
    }),
  );

  app.post("/api/recall-occurrences", async (request, reply) => {
    const input = openRecallRequestSchema.parse(request.body);
    return reply.status(201).send(
      recallOccurrenceSchema.parse(dependencies.recall.open(input.revisionId, input.match)),
    );
  });

  app.post<{ Params: { occurrenceId: string } }>(
    "/api/recall-occurrences/:occurrenceId/evaluation",
    async (request) => {
      const input = evaluateRecallRequestSchema.parse(request.body);
      return recallEvaluationSchema.parse(
        await dependencies.recall.evaluate(request.params.occurrenceId, input.userInterpretation),
      );
    },
  );

  return app;
}
