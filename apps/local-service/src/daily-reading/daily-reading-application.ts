import type {
  CreateDailyReadingBookRequest,
  CreateDailyReadingBookResponse,
  DailyReadingAutomation,
  DailyReadingRun,
  DailyReadingTriggerReason,
  DailyReadingWorkflowTrace,
  DailyReadingWorkflowTraceSummary,
  UpdateDailyReadingAutomationRequest,
} from "@lumen/api-contract";
import { Readable } from "node:stream";

import { ApplicationError } from "../application/errors.js";
import type {
  ClockPort,
  ControlledTaskRuntimePort,
  IdGeneratorPort,
  RuntimeRepositoryPort,
  TransactionPort,
} from "../application/ports.js";
import type { LibraryApplication } from "../application/library.js";
import type { BookRepository } from "../content/book-repository.js";
import { DailyReadingRepository } from "./daily-reading-repository.js";
import { DailyReadingSourceRegistry } from "./source-registry.js";

interface Dependencies {
  books: BookRepository;
  clock: ClockPort;
  ids: IdGeneratorPort;
  library: LibraryApplication;
  operations: RuntimeRepositoryPort;
  repository: DailyReadingRepository;
  runtime: ControlledTaskRuntimePort;
  sources: DailyReadingSourceRegistry;
  transaction: TransactionPort;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let value = formatterCache.get(timeZone);
  if (value === undefined) {
    value = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, value);
  }
  return value;
}

function localParts(instant: Date, timeZone: string): Record<string, number> {
  return Object.fromEntries(formatter(timeZone).formatToParts(instant)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
}

export function localDateAt(instant: Date, timeZone: string): string {
  const parts = localParts(instant, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function zonedInstant(date: string, localTime: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = localTime.split(":").map(Number);
  let guess = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = localParts(new Date(guess), timeZone);
    const rendered = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!);
    guess += Date.UTC(year!, month! - 1, day!, hour!, minute!) - rendered;
  }
  return new Date(guess);
}

export function nextScheduledAt(after: Date, localTime: string, timeZone: string): string {
  const today = localDateAt(after, timeZone);
  let target = zonedInstant(today, localTime, timeZone);
  if (target <= after) {
    const noon = zonedInstant(today, "12:00", timeZone);
    noon.setUTCDate(noon.getUTCDate() + 1);
    target = zonedInstant(localDateAt(noon, timeZone), localTime, timeZone);
  }
  return target.toISOString();
}

function safeFilename(title: string): string {
  const normalized = title.normalize("NFKD").replace(/[^a-zA-Z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "").slice(0, 80).toLocaleLowerCase("en-US");
  return `${normalized || "daily-reading"}.md`;
}

export class DailyReadingApplication {
  private readonly active = new Set<string>();

  constructor(private readonly dependencies: Dependencies) {}

  createBook(input: CreateDailyReadingBookRequest): CreateDailyReadingBookResponse {
    try { formatter(input.timeZone); } catch {
      throw new ApplicationError({
        code: "DAILY_READING_SOURCE_UNAVAILABLE",
        message: "无效的 IANA 时区",
        statusCode: 400,
      });
    }
    const now = this.dependencies.clock.now();
    const bookId = this.dependencies.ids.generate();
    const automationId = this.dependencies.ids.generate();
    const operationId = this.dependencies.ids.generate();
    const runId = this.dependencies.ids.generate();
    const localDate = localDateAt(new Date(now), input.timeZone);
    const nextRunAt = nextScheduledAt(new Date(now), input.localTime, input.timeZone);
    const result = this.dependencies.transaction.run(() => {
      const book = this.dependencies.books.createBook({
        bookId,
        title: input.title.trim(),
        formatId: "markdown",
        pages: [],
        now,
      });
      const automation = this.dependencies.repository.createAutomation({
        automationId,
        bookId,
        interestDescription: input.interestDescription.trim(),
        localTime: input.localTime,
        timeZone: input.timeZone,
        nextRunAt,
        now,
      });
      this.dependencies.operations.createOperation({
        operationId,
        taskType: "daily-reading.workflow",
        taskVersion: "daily-reading.workflow.v1",
        documentId: null,
        revisionId: null,
        contextSnapshot: JSON.stringify({ automationId, runId }),
        now,
      });
      const run = this.dependencies.repository.createRun({
        runId,
        automationId,
        operationId,
        triggerReason: "initial",
        scheduledFor: now,
        localDate,
        now,
      });
      return { book, automation, run };
    });
    void this.executeRun(runId, operationId);
    return result;
  }

  getAutomation(bookId: string): DailyReadingAutomation {
    const automation = this.dependencies.repository.getAutomationByBook(bookId);
    if (automation === null) throw this.notFound();
    return automation;
  }

  updateAutomation(
    bookId: string,
    input: UpdateDailyReadingAutomationRequest,
  ): DailyReadingAutomation {
    const current = this.getAutomation(bookId);
    const localTime = input.localTime ?? current.localTime;
    const timeZone = input.timeZone ?? current.timeZone;
    try { formatter(timeZone); } catch {
      throw new ApplicationError({
        code: "DAILY_READING_SOURCE_UNAVAILABLE",
        message: "无效的 IANA 时区",
        statusCode: 400,
      });
    }
    const now = this.dependencies.clock.now();
    return this.dependencies.transaction.run(() => this.dependencies.repository.updateAutomation(
      current.automationId,
      { ...input, nextRunAt: nextScheduledAt(new Date(now), localTime, timeZone), now },
    ))!;
  }

  retry(bookId: string): DailyReadingRun {
    const automation = this.getAutomation(bookId);
    return this.startRun(automation, "manual_retry", this.dependencies.clock.now());
  }

  listWorkflowTraces(input: { limit: number; cursor?: string | undefined }): { traces: DailyReadingWorkflowTraceSummary[]; nextCursor: string | null } {
    return this.dependencies.repository.listWorkflowTraces(input);
  }

  getWorkflowTrace(runId: string): DailyReadingWorkflowTrace {
    const trace = this.dependencies.repository.getWorkflowTrace(runId);
    if (trace === null) {
      throw new ApplicationError({
        code: "DAILY_READING_AUTOMATION_NOT_FOUND",
        message: "未找到指定每日阅读 Workflow",
        statusCode: 404,
      });
    }
    return trace;
  }

  runDue(triggerReason: "scheduled" | "startup_catchup"): void {
    const now = this.dependencies.clock.now();
    for (const automation of this.dependencies.repository.listDue(now)) {
      try { this.startRun(automation, triggerReason, now); } catch (error) {
        if (!(error instanceof ApplicationError)) continue;
      }
    }
  }

  interruptRunning(): void {
    this.dependencies.repository.interruptRunning(this.dependencies.clock.now());
  }

  private startRun(
    automation: DailyReadingAutomation,
    triggerReason: DailyReadingTriggerReason,
    scheduledFor: string,
  ): DailyReadingRun {
    const now = this.dependencies.clock.now();
    const localDate = localDateAt(new Date(now), automation.timeZone);
    if (this.dependencies.repository.hasUnfinishedRun(automation.automationId)) {
      throw new ApplicationError({
        code: "DAILY_READING_IN_PROGRESS",
        message: "这本 Book 的每日阅读任务正在执行",
        statusCode: 409,
      });
    }
    if (this.dependencies.repository.hasSuccessfulRun(automation.automationId, localDate)) {
      throw new ApplicationError({
        code: "DAILY_READING_ALREADY_COMPLETED",
        message: "这本 Book 今天已经自动新增过一篇材料",
        statusCode: 409,
      });
    }
    const operationId = this.dependencies.ids.generate();
    const runId = this.dependencies.ids.generate();
    const run = this.dependencies.transaction.run(() => {
      this.dependencies.operations.createOperation({
        operationId,
        taskType: "daily-reading.workflow",
        taskVersion: "daily-reading.workflow.v1",
        documentId: null,
        revisionId: null,
        contextSnapshot: JSON.stringify({ automationId: automation.automationId, runId }),
        now,
      });
      return this.dependencies.repository.createRun({
        runId,
        automationId: automation.automationId,
        operationId,
        triggerReason,
        scheduledFor,
        localDate,
        now,
      });
    });
    void this.executeRun(runId, operationId);
    return run;
  }

  private async executeRun(runId: string, operationId: string): Promise<void> {
    const run = this.dependencies.repository.getRun(runId);
    if (run === null) return;
    const automation = this.dependencies.repository.getAutomation(run.automationId);
    if (automation === null) return;
    if (this.active.has(automation.automationId)) return;
    this.active.add(automation.automationId);
    const now = this.dependencies.clock.now();
    try {
      this.dependencies.transaction.run(() => {
        this.dependencies.repository.markRunning(
          runId,
          nextScheduledAt(new Date(now), automation.localTime, automation.timeZone),
          now,
        );
        this.dependencies.operations.markOperationRunning(operationId, now);
      });
      const profile = await this.dependencies.runtime.executeDailyReadingInterest({
        operationId,
        interestDescription: automation.interestDescription,
      });
      const profileAt = this.dependencies.clock.now();
      this.dependencies.transaction.run(() => {
        this.dependencies.repository.saveInterestProfile(automation.automationId, profile, profileAt);
        this.dependencies.repository.appendRunEvent({
          runId,
          stage: "interest.completed",
          level: "info",
          message: "用户兴趣已解析为受控阅读画像",
          data: { profile },
          now: profileAt,
        });
      });
      const candidates = await this.dependencies.sources.discover();
      this.dependencies.repository.appendRunEvent({
        runId,
        stage: "sources.discovered",
        level: candidates.length === 0 ? "warning" : "info",
        message: `受控来源发现 ${candidates.length} 个候选`,
        data: {
          candidates: candidates.map((candidate) => ({
            candidateId: candidate.candidateId,
            sourceId: candidate.sourceId,
            publisher: candidate.publisher,
            title: candidate.title,
            url: candidate.url,
            publishedAt: candidate.publishedAt,
          })),
        },
        now: this.dependencies.clock.now(),
      });
      if (candidates.length === 0) {
        this.finishNoContent(runId, operationId, "受控来源当前没有可用候选");
        return;
      }
      const selection = await this.dependencies.runtime.executeDailyReadingSelection({
        operationId,
        interestDescription: automation.interestDescription,
        candidates: candidates.map(({ candidateId, publisher, title, summary, publishedAt }) => ({
          candidateId, publisher, title, summary, publishedAt,
        })),
      });
      const ranked = selection.rankedCandidateIds
        .map((candidateId) => candidates.find((candidate) => candidate.candidateId === candidateId))
        .filter((candidate) => candidate !== undefined);
      this.dependencies.repository.appendRunEvent({
        runId,
        stage: "candidates.ranked",
        level: ranked.length === 0 ? "warning" : "info",
        message: `模型返回 ${ranked.length} 个有效候选排序`,
        data: {
          rankedCandidates: ranked.map((candidate) => ({
            candidateId: candidate.candidateId,
            sourceId: candidate.sourceId,
            title: candidate.title,
          })),
        },
        now: this.dependencies.clock.now(),
      });
      for (const candidate of ranked) {
        const article = await this.dependencies.sources.extract(candidate);
        if (article === null) {
          this.dependencies.repository.appendRunEvent({
            runId,
            stage: "article.rejected",
            level: "warning",
            message: "候选未通过正文或来源规则校验",
            data: { candidateId: candidate.candidateId, sourceId: candidate.sourceId, title: candidate.title },
            now: this.dependencies.clock.now(),
          });
          continue;
        }
        if (this.dependencies.repository.sourceExists(article.canonicalUrl)) {
          this.dependencies.repository.appendRunEvent({
            runId,
            stage: "article.rejected",
            level: "warning",
            message: "候选原文已导入过，跳过去重结果",
            data: {
              candidateId: candidate.candidateId,
              sourceId: candidate.sourceId,
              title: candidate.title,
              canonicalUrl: article.canonicalUrl,
            },
            now: this.dependencies.clock.now(),
          });
          continue;
        }
        this.dependencies.repository.appendRunEvent({
          runId,
          stage: "article.selected",
          level: "info",
          message: "已选定通过校验的原文并完成 Markdown 转换",
          data: {
            candidateId: article.candidateId,
            sourceId: article.sourceId,
            sourceVersion: article.sourceVersion,
            publisher: article.publisher,
            title: article.title,
            originalUrl: article.url,
            canonicalUrl: article.canonicalUrl,
            retrievedAt: article.retrievedAt,
            markdownCharacterCount: article.markdown.length,
          },
          now: this.dependencies.clock.now(),
        });
        const currentAutomation = this.dependencies.repository.getAutomation(automation.automationId);
        if (currentAutomation === null || !currentAutomation.enabled) {
          const interruptedAt = this.dependencies.clock.now();
          this.dependencies.transaction.run(() => {
            this.dependencies.repository.finishRun({
              runId,
              status: "interrupted",
              errorCode: "OPERATION_CANCELLED",
              errorMessage: "每日阅读自动化已暂停",
              now: interruptedAt,
            });
            this.dependencies.operations.cancelOperation(operationId, interruptedAt);
          });
          return;
        }
        const imported = await this.dependencies.library.importDocument(
          safeFilename(article.title),
          Readable.from([Buffer.from(article.markdown, "utf8")]),
          "text/markdown",
        );
        this.dependencies.repository.appendRunEvent({
          runId,
          stage: "document.imported",
          level: "info",
          message: "Markdown 已通过正式导入链路创建 Document",
          data: {
            documentId: imported.document.documentId,
            revisionId: imported.document.activeRevisionId,
            importOperationId: imported.operation.operationId,
          },
          now: this.dependencies.clock.now(),
        });
        const pageId = this.dependencies.ids.generate();
        const completedAt = this.dependencies.clock.now();
        const source = {
          sourceId: article.sourceId,
          publisher: article.publisher,
          title: article.title,
          author: article.author,
          publishedAt: article.publishedAt,
          originalUrl: article.url,
        };
        this.dependencies.transaction.run(() => {
          this.dependencies.repository.saveDocumentSource({
            documentId: imported.document.documentId,
            sourceId: article.sourceId,
            sourceVersion: article.sourceVersion,
            publisher: article.publisher,
            title: article.title,
            author: article.author,
            publishedAt: article.publishedAt,
            originalUrl: article.url,
            canonicalUrl: article.canonicalUrl,
            retrievedAt: article.retrievedAt,
            attribution: article.attribution,
          });
          this.dependencies.books.appendPage({
            pageId,
            bookId: automation.bookId,
            documentId: imported.document.documentId,
            origin: "scheduled_reading",
            viewedAt: null,
            dailyReadingRunId: runId,
            now: completedAt,
          });
          this.dependencies.repository.appendRunEvent({
            runId,
            stage: "page.appended",
            level: "info",
            message: "Document 已作为未查看 Page 追加到目标 Book",
            data: {
              bookId: automation.bookId,
              documentId: imported.document.documentId,
              pageId,
              origin: "scheduled_reading",
            },
            now: completedAt,
          });
          this.dependencies.repository.completeRun({
            runId,
            automationId: automation.automationId,
            localDate: run.localDate,
            source,
            documentId: imported.document.documentId,
            pageId,
            now: completedAt,
          });
          this.dependencies.operations.completeOperation(operationId, completedAt);
        });
        return;
      }
      this.finishNoContent(runId, operationId, "候选文章均未通过正文、去重或来源规则校验");
    } catch (error) {
      const message = error instanceof Error ? error.message : "每日阅读任务执行失败";
      const code = error instanceof ApplicationError ? error.code : "DAILY_READING_SOURCE_UNAVAILABLE";
      const failedAt = this.dependencies.clock.now();
      this.dependencies.transaction.run(() => {
        this.dependencies.repository.finishRun({ runId, status: "failed", errorCode: code, errorMessage: message, now: failedAt });
        this.dependencies.operations.failOperation(operationId, code, message, failedAt);
      });
    } finally {
      this.active.delete(automation.automationId);
    }
  }

  private finishNoContent(runId: string, operationId: string, message: string): void {
    const now = this.dependencies.clock.now();
    this.dependencies.transaction.run(() => {
      this.dependencies.repository.finishRun({
        runId, status: "no_content", errorCode: "DAILY_READING_NO_CONTENT", errorMessage: message, now,
      });
      this.dependencies.operations.completeOperation(operationId, now);
    });
  }

  private notFound(): ApplicationError {
    return new ApplicationError({
      code: "DAILY_READING_AUTOMATION_NOT_FOUND",
      message: "未找到指定 Book 的每日阅读自动化",
      statusCode: 404,
    });
  }
}
