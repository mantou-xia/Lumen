import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import {
  annotationListSchema,
  annotationRangeQuerySchema,
  annotationSchema,
  applicationErrorSchema,
  createAnnotationRequestSchema,
  createWorkspaceTurnRequestSchema,
  healthResponseSchema,
  importDocumentResponseSchema,
  importOperationSchema,
  documentListResponseSchema,
  readerDocumentQuerySchema,
  readerDocumentSchema,
  readingProgressSchema,
  updateReadingProgressRequestSchema,
  providerStatusSchema,
  translateSelectionRequestSchema,
  translationRangeListSchema,
  translationRangeQuerySchema,
  translationResultSchema,
  learningExpressionDetailQuerySchema,
  learningExpressionDetailSchema,
  learningExpressionListSchema,
  learningItemSchema,
  learningListQuerySchema,
  lexicalProfileResponseSchema,
  saveLearningItemRequestSchema,
  updateExpressionStatusRequestSchema,
  updateLearningNoteRequestSchema,
  updateAnnotationRequestSchema,
  evaluateRecallRequestSchema,
  openRecallRequestSchema,
  openWorkspaceSessionRequestSchema,
  operationEventListSchema,
  operationEventQuerySchema,
  operationSchema,
  recallEvaluationSchema,
  recallMatchListSchema,
  recallMatchesRequestSchema,
  recallOccurrenceSchema,
  semanticMappingQuerySchema,
  sourceMappingListSchema,
  sourceMappingQuerySchema,
  workspaceSessionSchema,
  workspaceTurnSchema,
} from "@lumen/api-contract";
import Fastify, { type FastifyInstance } from "fastify";

import { ApplicationError } from "./application/errors.js";
import type { AnnotationApplication } from "./application/annotation.js";
import type { LibraryApplication } from "./application/library.js";
import type { ReaderApplication } from "./application/reader.js";
import type { TranslationApplication } from "./application/translation.js";
import type { LearningApplication } from "./application/learning.js";
import type { LexicalApplication } from "./application/lexical.js";
import type { RecallApplication } from "./application/recall.js";
import type { RuntimeApplication } from "./application/runtime.js";
import type { ResourceApplication } from "./application/resource.js";
import type { SourceMappingApplication } from "./application/source-mapping.js";
import type { WorkspaceApplication } from "./application/workspace.js";
import type { LumenDatabase } from "./infrastructure/database/database.js";

export interface LocalServiceDependencies {
  annotations: AnnotationApplication;
  database: LumenDatabase;
  library: LibraryApplication;
  reader: ReaderApplication;
  translation: TranslationApplication;
  learning: LearningApplication;
  lexical: LexicalApplication;
  recall: RecallApplication;
  runtime: RuntimeApplication;
  resources: ResourceApplication;
  sourceMappings: SourceMappingApplication;
  workspace: WorkspaceApplication;
  logger?: boolean;
}

function readByteRange(value: string | string[] | undefined): { start: number; end: number } | null {
  if (value === undefined) return null;
  if (typeof value !== "string") {
    throw new ApplicationError({
      code: "RESOURCE_RANGE_INVALID",
      message: "一次只能请求一个资源字节范围",
      statusCode: 416,
    });
  }
  const match = /^bytes=(\d+)-(\d+)$/.exec(value.trim());
  if (match === null) {
    throw new ApplicationError({
      code: "RESOURCE_RANGE_INVALID",
      message: "资源 Range 必须使用 bytes=start-end 格式",
      statusCode: 416,
    });
  }
  return { start: Number(match[1]), end: Number(match[2]) };
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

const terminalOperationStatuses = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

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

  app.get<{ Params: { resourceId: string } }>(
    "/api/resources/:resourceId",
    async (request, reply) => {
      const result = await dependencies.resources.read(
        request.params.resourceId,
        readByteRange(request.headers.range),
      );
      const contentLength = result.range === null
        ? result.byteSize
        : result.range.end - result.range.start + 1;
      reply.header("accept-ranges", "bytes");
      reply.header("content-type", result.mediaType);
      reply.header("content-length", String(contentLength));
      reply.header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(result.originalFilename)}`);
      reply.header("x-content-type-options", "nosniff");
      if (result.range !== null) {
        reply.status(206);
        reply.header(
          "content-range",
          `bytes ${result.range.start}-${result.range.end}/${result.byteSize}`,
        );
      }
      return reply.send(result.stream);
    },
  );

  app.post<{ Params: { revisionId: string } }>(
    "/api/revisions/:revisionId/source-mappings/by-semantic-point",
    async (request) => {
      const query = semanticMappingQuerySchema.parse(request.body);
      return sourceMappingListSchema.parse({
        mappings: dependencies.sourceMappings.fromSemanticPoint(
          request.params.revisionId,
          query.blockId,
          query.offset,
        ),
      });
    },
  );

  app.post<{ Params: { revisionId: string } }>(
    "/api/revisions/:revisionId/source-mappings/by-source-offset",
    async (request) => {
      const query = sourceMappingQuerySchema.parse(request.body);
      return sourceMappingListSchema.parse({
        mappings: dependencies.sourceMappings.fromSourceOffset(
          request.params.revisionId,
          query.sourceOffset,
        ),
      });
    },
  );

  app.post("/api/imports", async (request, reply) => {
    if (!(request.body instanceof Readable)) {
      throw new ApplicationError({
        code: "DOCUMENT_SOURCE_INVALID",
        message: "导入请求必须包含 Markdown 文件内容",
        statusCode: 400,
      });
    }

    const response = await dependencies.library.importDocument(
      readFilenameHeader(request.headers["x-lumen-filename"]),
      request.body,
      request.headers["content-type"] ?? null,
    );
    return reply.status(201).send(importDocumentResponseSchema.parse(response));
  });

  app.post<{ Params: { documentId: string } }>(
    "/api/documents/:documentId/revisions",
    async (request, reply) => {
      if (!(request.body instanceof Readable)) {
        throw new ApplicationError({
          code: "DOCUMENT_SOURCE_INVALID",
          message: "更新请求必须包含文档文件内容",
          statusCode: 400,
        });
      }
      const response = await dependencies.library.updateDocument(
        request.params.documentId,
        readFilenameHeader(request.headers["x-lumen-filename"]),
        request.body,
        request.headers["content-type"] ?? null,
      );
      return reply.status(201).send(importDocumentResponseSchema.parse(response));
    },
  );

  app.get<{ Params: { documentId: string } }>(
    "/api/reader/documents/:documentId",
    async (request) => {
      const query = readerDocumentQuerySchema.parse(request.query);
      return readerDocumentSchema.parse(
        await dependencies.reader.openDocument(request.params.documentId, query.revisionId),
      );
    },
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
    "/api/reader/documents/:documentId/workspace",
    async (request) => {
      const input = openWorkspaceSessionRequestSchema.parse(request.body);
      return workspaceSessionSchema.parse(
        dependencies.workspace.open(request.params.documentId, input.revisionId),
      );
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/workspaces/:sessionId",
    async (request) => workspaceSessionSchema.parse(
      dependencies.workspace.get(request.params.sessionId),
    ),
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/workspaces/:sessionId/turns",
    async (request, reply) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      const abortIfIncomplete = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      request.raw.once("aborted", abort);
      reply.raw.once("close", abortIfIncomplete);
      try {
        return workspaceTurnSchema.parse(
          await dependencies.workspace.ask(
            request.params.sessionId,
            createWorkspaceTurnRequestSchema.parse(request.body),
            controller.signal,
          ),
        );
      } finally {
        request.raw.off("aborted", abort);
        reply.raw.off("close", abortIfIncomplete);
      }
    },
  );

  app.get<{ Params: { operationId: string } }>(
    "/api/operations/:operationId",
    async (request) => operationSchema.parse(dependencies.runtime.getOperation(request.params.operationId)),
  );

  app.post<{ Params: { operationId: string } }>(
    "/api/operations/:operationId/cancel",
    async (request, reply) => {
      reply.status(202);
      return operationSchema.parse(dependencies.runtime.cancel(request.params.operationId));
    },
  );

  app.get<{
    Params: { operationId: string };
    Querystring: { after?: string; limit?: string };
  }>(
    "/api/operations/:operationId/events",
    async (request) => operationEventListSchema.parse({
      events: dependencies.runtime.listEvents(
        request.params.operationId,
        operationEventQuerySchema.parse(request.query),
      ),
    }),
  );

  app.get<{
    Params: { operationId: string };
    Querystring: { after?: string };
  }>(
    "/api/operations/:operationId/events/stream",
    async (request, reply) => {
      const query = operationEventQuerySchema.parse(request.query);
      const lastEventId = typeof request.headers["last-event-id"] === "string"
        ? Number(request.headers["last-event-id"])
        : 0;
      let afterSequence = Math.max(
        query.after,
        Number.isSafeInteger(lastEventId) && lastEventId >= 0 ? lastEventId : 0,
      );
      let operation = dependencies.runtime.getOperation(request.params.operationId);
      reply.hijack();
      reply.raw.writeHead(200, {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
      });
      reply.raw.write("retry: 1000\n\n");

      const writeAvailableEvents = () => {
        const events = dependencies.runtime.listEvents(request.params.operationId, {
          after: afterSequence,
          limit: 500,
        });
        for (const event of events) {
          reply.raw.write(`id: ${event.sequence}\n`);
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
          afterSequence = event.sequence;
        }
      };

      writeAvailableEvents();
      if (terminalOperationStatuses.has(operation.status)) {
        reply.raw.end();
        return;
      }

      const timer = setInterval(() => {
        if (reply.raw.destroyed) {
          clearInterval(timer);
          return;
        }
        writeAvailableEvents();
        operation = dependencies.runtime.getOperation(request.params.operationId);
        if (terminalOperationStatuses.has(operation.status)) {
          clearInterval(timer);
          reply.raw.end();
        }
      }, 250);
      request.raw.once("close", () => clearInterval(timer));
    },
  );

  app.post<{ Params: { documentId: string } }>(
    "/api/reader/documents/:documentId/translations",
    async (request, reply) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      const abortIfIncomplete = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      request.raw.once("aborted", abort);
      reply.raw.once("close", abortIfIncomplete);
      try {
        return translationResultSchema.parse(
          await dependencies.translation.translate(
            request.params.documentId,
            translateSelectionRequestSchema.parse(request.body),
            controller.signal,
          ),
        );
      } finally {
        request.raw.off("aborted", abort);
        reply.raw.off("close", abortIfIncomplete);
      }
    },
  );

  app.post<{ Params: { documentId: string } }>(
    "/api/reader/documents/:documentId/translation-ranges",
    async (request) => translationRangeListSchema.parse({
      ranges: dependencies.translation.listRanges(
        request.params.documentId,
        translationRangeQuerySchema.parse(request.body),
      ),
    }),
  );

  app.get<{ Params: { translationId: string } }>(
    "/api/translations/:translationId",
    async (request) => translationResultSchema.parse(
      dependencies.translation.getResult(request.params.translationId),
    ),
  );

  app.post<{ Params: { translationId: string } }>(
    "/api/translations/:translationId/retry",
    async (request, reply) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      const abortIfIncomplete = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      request.raw.once("aborted", abort);
      reply.raw.once("close", abortIfIncomplete);
      try {
        return translationResultSchema.parse(
          await dependencies.translation.retry(request.params.translationId, controller.signal),
        );
      } finally {
        request.raw.off("aborted", abort);
        reply.raw.off("close", abortIfIncomplete);
      }
    },
  );

  app.get<{ Params: { translationId: string } }>(
    "/api/translations/:translationId/lexical-profile",
    async (request, reply) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      const abortIfIncomplete = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      request.raw.once("aborted", abort);
      reply.raw.once("close", abortIfIncomplete);
      try {
        return lexicalProfileResponseSchema.parse(
          await dependencies.lexical.getProfile(
            request.params.translationId,
            false,
            controller.signal,
          ),
        );
      } finally {
        request.raw.off("aborted", abort);
        reply.raw.off("close", abortIfIncomplete);
      }
    },
  );

  app.post<{ Params: { translationId: string } }>(
    "/api/translations/:translationId/lexical-profile/refresh",
    async (request, reply) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      const abortIfIncomplete = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      request.raw.once("aborted", abort);
      reply.raw.once("close", abortIfIncomplete);
      try {
        return lexicalProfileResponseSchema.parse(
          await dependencies.lexical.getProfile(
            request.params.translationId,
            true,
            controller.signal,
          ),
        );
      } finally {
        request.raw.off("aborted", abort);
        reply.raw.off("close", abortIfIncomplete);
      }
    },
  );

  app.post("/api/learning-items", async (request, reply) => {
    const input = saveLearningItemRequestSchema.parse(request.body);
    return reply.status(201).send(
      learningItemSchema.parse(dependencies.learning.saveFromTranslation(input.translationId)),
    );
  });

  app.get("/api/learning-items", async (request) => {
    const input = learningListQuerySchema.parse(request.query);
    return learningExpressionListSchema.parse(dependencies.learning.queryItems(input));
  });

  app.get<{ Params: { expressionId: string } }>(
    "/api/learning-items/:expressionId",
    async (request) => {
      const query = learningExpressionDetailQuerySchema.parse(request.query);
      return learningExpressionDetailSchema.parse(
        dependencies.learning.getDetails(request.params.expressionId, query.contextSort),
      );
    },
  );

  app.patch<{ Params: { expressionId: string } }>(
    "/api/learning-items/:expressionId/status",
    async (request) => {
      const input = updateExpressionStatusRequestSchema.parse(request.body);
      return learningExpressionDetailSchema.parse(
        dependencies.learning.updateStatus(request.params.expressionId, input.status),
      );
    },
  );

  app.patch<{ Params: { expressionId: string } }>(
    "/api/learning-items/:expressionId/note",
    async (request) => {
      const input = updateLearningNoteRequestSchema.parse(request.body);
      return learningExpressionDetailSchema.parse(
        dependencies.learning.updateExpressionNote(request.params.expressionId, input.note),
      );
    },
  );

  app.patch<{ Params: { expressionId: string; contextId: string } }>(
    "/api/learning-items/:expressionId/contexts/:contextId/note",
    async (request) => {
      const input = updateLearningNoteRequestSchema.parse(request.body);
      return learningExpressionDetailSchema.parse(
        dependencies.learning.updateContextNote(
          request.params.expressionId,
          request.params.contextId,
          input.note,
        ),
      );
    },
  );

  app.post<{ Params: { expressionId: string; contextId: string } }>(
    "/api/learning-items/:expressionId/contexts/:contextId/archive",
    async (request) => learningExpressionDetailSchema.parse(
      dependencies.learning.archiveContext(
        request.params.expressionId,
        request.params.contextId,
      ),
    ),
  );

  app.post<{ Params: { documentId: string } }>(
    "/api/reader/documents/:documentId/annotations",
    async (request, reply) => reply.status(201).send(annotationSchema.parse(
      dependencies.annotations.create(
        request.params.documentId,
        createAnnotationRequestSchema.parse(request.body),
      ),
    )),
  );

  app.post<{ Params: { documentId: string } }>(
    "/api/reader/documents/:documentId/annotations/query",
    async (request) => {
      const input = annotationRangeQuerySchema.parse(request.body);
      return annotationListSchema.parse({
        annotations: dependencies.annotations.listRanges(request.params.documentId, input),
      });
    },
  );

  app.get<{ Params: { annotationId: string } }>(
    "/api/annotations/:annotationId",
    async (request) => annotationSchema.parse(
      dependencies.annotations.get(request.params.annotationId),
    ),
  );

  app.patch<{ Params: { annotationId: string } }>(
    "/api/annotations/:annotationId",
    async (request) => {
      const input = updateAnnotationRequestSchema.parse(request.body);
      return annotationSchema.parse(
        dependencies.annotations.update(request.params.annotationId, input.note),
      );
    },
  );

  app.post<{ Params: { annotationId: string } }>(
    "/api/annotations/:annotationId/archive",
    async (request) => annotationSchema.parse(
      dependencies.annotations.archive(request.params.annotationId),
    ),
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
