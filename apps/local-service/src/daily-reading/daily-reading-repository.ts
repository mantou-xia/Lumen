import type {
  DailyReadingAutomation,
  DailyReadingInterestProfile,
  DailyReadingRun,
  DailyReadingSourceSnapshot,
  DailyReadingTriggerReason,
  DailyReadingWorkflowEvent,
  DailyReadingWorkflowEventLevel,
  DailyReadingWorkflowStage,
  DailyReadingWorkflowTrace,
  DailyReadingWorkflowTraceSummary,
  UpdateDailyReadingAutomationRequest,
} from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

interface AutomationRow {
  id: string;
  book_id: string;
  interest_description: string;
  interest_profile_snapshot: string | null;
  local_time: string;
  time_zone: string;
  enabled: number;
  next_run_at: string;
  last_attempt_at: string | null;
  last_success_local_date: string | null;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  automation_id: string;
  status: DailyReadingRun["status"];
  trigger_reason: DailyReadingTriggerReason;
  local_date: string;
  scheduled_for: string;
  source_snapshot: string | null;
  document_id: string | null;
  page_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

interface WorkflowTraceRow extends RunRow {
  book_id: string;
  book_title: string;
  operation_id: string | null;
  interest_description: string;
  event_count: number;
}

interface WorkflowEventRow {
  run_id: string;
  sequence: number;
  stage: DailyReadingWorkflowStage;
  level: DailyReadingWorkflowEventLevel;
  message: string;
  data_snapshot: string;
  created_at: string;
}

const parseJson = <T>(value: string | null): T | null => value === null ? null : JSON.parse(value) as T;

function mapRun(row: RunRow): DailyReadingRun {
  return {
    runId: row.id,
    automationId: row.automation_id,
    status: row.status,
    triggerReason: row.trigger_reason,
    localDate: row.local_date,
    scheduledFor: row.scheduled_for,
    source: parseJson<DailyReadingSourceSnapshot>(row.source_snapshot),
    documentId: row.document_id,
    pageId: row.page_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function mapWorkflowTraceSummary(row: WorkflowTraceRow): DailyReadingWorkflowTraceSummary {
  return {
    runId: row.id,
    automationId: row.automation_id,
    bookId: row.book_id,
    bookTitle: row.book_title,
    operationId: row.operation_id,
    status: row.status,
    triggerReason: row.trigger_reason,
    localDate: row.local_date,
    source: parseJson<DailyReadingSourceSnapshot>(row.source_snapshot),
    eventCount: row.event_count,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export class DailyReadingRepository {
  constructor(private readonly connection: DatabaseSync) {}

  getAutomation(automationId: string): DailyReadingAutomation | null {
    const row = this.connection.prepare("SELECT * FROM daily_reading_automations WHERE id = ?")
      .get(automationId) as unknown as AutomationRow | undefined;
    return row === undefined ? null : this.mapAutomation(row);
  }

  getAutomationByBook(bookId: string): DailyReadingAutomation | null {
    const row = this.connection.prepare("SELECT * FROM daily_reading_automations WHERE book_id = ?")
      .get(bookId) as unknown as AutomationRow | undefined;
    return row === undefined ? null : this.mapAutomation(row);
  }

  createAutomation(input: {
    automationId: string;
    bookId: string;
    interestDescription: string;
    localTime: string;
    timeZone: string;
    nextRunAt: string;
    now: string;
  }): DailyReadingAutomation {
    this.connection.prepare(`
      INSERT INTO daily_reading_automations (
        id, book_id, interest_description, local_time, time_zone, enabled,
        next_run_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      input.automationId,
      input.bookId,
      input.interestDescription,
      input.localTime,
      input.timeZone,
      input.nextRunAt,
      input.now,
      input.now,
    );
    return this.getAutomation(input.automationId)!;
  }

  updateAutomation(
    automationId: string,
    input: UpdateDailyReadingAutomationRequest & { nextRunAt: string; now: string },
  ): DailyReadingAutomation | null {
    const current = this.getAutomation(automationId);
    if (current === null) return null;
    this.connection.prepare(`
      UPDATE daily_reading_automations SET
        interest_description = ?, local_time = ?, time_zone = ?, enabled = ?,
        next_run_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.interestDescription ?? current.interestDescription,
      input.localTime ?? current.localTime,
      input.timeZone ?? current.timeZone,
      (input.enabled ?? current.enabled) ? 1 : 0,
      input.nextRunAt,
      input.now,
      automationId,
    );
    return this.getAutomation(automationId);
  }

  saveInterestProfile(automationId: string, profile: DailyReadingInterestProfile, now: string): void {
    this.connection.prepare(`
      UPDATE daily_reading_automations
      SET interest_profile_snapshot = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(profile), now, automationId);
  }

  createRun(input: {
    runId: string;
    automationId: string;
    operationId: string;
    triggerReason: DailyReadingTriggerReason;
    scheduledFor: string;
    localDate: string;
    now: string;
  }): DailyReadingRun {
    this.connection.prepare(`
      INSERT INTO daily_reading_runs (
        id, automation_id, operation_id, trigger_reason, scheduled_for,
        local_date, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'requested', ?)
    `).run(
      input.runId,
      input.automationId,
      input.operationId,
      input.triggerReason,
      input.scheduledFor,
      input.localDate,
      input.now,
    );
    this.appendRunEvent({
      runId: input.runId,
      stage: "run.requested",
      level: "info",
      message: "每日阅读运行已创建",
      data: {
        operationId: input.operationId,
        triggerReason: input.triggerReason,
        scheduledFor: input.scheduledFor,
        localDate: input.localDate,
      },
      now: input.now,
    });
    return this.getRun(input.runId)!;
  }

  getRun(runId: string): DailyReadingRun | null {
    const row = this.connection.prepare("SELECT * FROM daily_reading_runs WHERE id = ?")
      .get(runId) as unknown as RunRow | undefined;
    return row === undefined ? null : mapRun(row);
  }

  listWorkflowTraces(limit = 100): DailyReadingWorkflowTraceSummary[] {
    const rows = this.connection.prepare(`
      SELECT r.*, a.book_id, a.interest_description, b.title AS book_title,
        COUNT(e.sequence) AS event_count
      FROM daily_reading_runs r
      JOIN daily_reading_automations a ON a.id = r.automation_id
      JOIN books b ON b.id = a.book_id
      LEFT JOIN daily_reading_run_events e ON e.run_id = r.id
      GROUP BY r.id
      ORDER BY r.created_at DESC
      LIMIT ?
    `).all(limit) as unknown as WorkflowTraceRow[];
    return rows.map(mapWorkflowTraceSummary);
  }

  getWorkflowTrace(runId: string): DailyReadingWorkflowTrace | null {
    const row = this.connection.prepare(`
      SELECT r.*, a.book_id, a.interest_description, b.title AS book_title,
        COUNT(e.sequence) AS event_count
      FROM daily_reading_runs r
      JOIN daily_reading_automations a ON a.id = r.automation_id
      JOIN books b ON b.id = a.book_id
      LEFT JOIN daily_reading_run_events e ON e.run_id = r.id
      WHERE r.id = ?
      GROUP BY r.id
    `).get(runId) as unknown as WorkflowTraceRow | undefined;
    if (row === undefined) return null;
    const events = this.connection.prepare(`
      SELECT * FROM daily_reading_run_events WHERE run_id = ? ORDER BY sequence
    `).all(runId) as unknown as WorkflowEventRow[];
    return {
      ...mapWorkflowTraceSummary(row),
      interestDescription: row.interest_description,
      events: events.map((event): DailyReadingWorkflowEvent => ({
        runId: event.run_id,
        sequence: event.sequence,
        stage: event.stage,
        level: event.level,
        message: event.message,
        data: JSON.parse(event.data_snapshot) as Record<string, unknown>,
        createdAt: event.created_at,
      })),
    };
  }

  appendRunEvent(input: {
    runId: string;
    stage: DailyReadingWorkflowStage;
    level: DailyReadingWorkflowEventLevel;
    message: string;
    data?: Record<string, unknown>;
    now: string;
  }): void {
    const row = this.connection.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
      FROM daily_reading_run_events WHERE run_id = ?
    `).get(input.runId) as { next_sequence: number };
    this.connection.prepare(`
      INSERT INTO daily_reading_run_events (
        run_id, sequence, stage, level, message, data_snapshot, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.runId,
      row.next_sequence,
      input.stage,
      input.level,
      input.message,
      JSON.stringify(input.data ?? {}),
      input.now,
    );
  }

  listDue(now: string): DailyReadingAutomation[] {
    const rows = this.connection.prepare(`
      SELECT * FROM daily_reading_automations
      WHERE enabled = 1 AND next_run_at <= ?
      ORDER BY next_run_at
    `).all(now) as unknown as AutomationRow[];
    return rows.map((row) => this.mapAutomation(row));
  }

  hasSuccessfulRun(automationId: string, localDate: string): boolean {
    return this.connection.prepare(`
      SELECT 1 FROM daily_reading_runs
      WHERE automation_id = ? AND local_date = ? AND status = 'completed'
    `).get(automationId, localDate) !== undefined;
  }

  hasUnfinishedRun(automationId: string): boolean {
    return this.connection.prepare(`
      SELECT 1 FROM daily_reading_runs
      WHERE automation_id = ? AND status IN ('requested', 'running') LIMIT 1
    `).get(automationId) !== undefined;
  }

  markRunning(runId: string, nextRunAt: string, now: string): void {
    const run = this.getRun(runId);
    if (run === null) return;
    this.connection.prepare(`
      UPDATE daily_reading_runs SET status = 'running' WHERE id = ?
    `).run(runId);
    this.connection.prepare(`
      UPDATE daily_reading_automations
      SET last_attempt_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?
    `).run(now, nextRunAt, now, run.automationId);
    this.appendRunEvent({
      runId,
      stage: "run.started",
      level: "info",
      message: "Workflow 开始执行",
      data: { nextRunAt },
      now,
    });
  }

  finishRun(input: {
    runId: string;
    status: "no_content" | "failed" | "interrupted";
    errorCode: string | null;
    errorMessage: string | null;
    now: string;
  }): void {
    this.connection.prepare(`
      UPDATE daily_reading_runs
      SET status = ?, error_code = ?, error_message = ?, completed_at = ?
      WHERE id = ?
    `).run(input.status, input.errorCode, input.errorMessage, input.now, input.runId);
    this.appendRunEvent({
      runId: input.runId,
      stage: input.status === "no_content"
        ? "run.no_content"
        : input.status === "interrupted"
          ? "run.interrupted"
          : "run.failed",
      level: input.status === "failed" ? "error" : "warning",
      message: input.errorMessage ?? `Workflow 已进入 ${input.status} 终态`,
      data: { errorCode: input.errorCode },
      now: input.now,
    });
  }

  completeRun(input: {
    runId: string;
    automationId: string;
    localDate: string;
    source: DailyReadingSourceSnapshot;
    documentId: string;
    pageId: string;
    now: string;
  }): void {
    this.connection.prepare(`
      UPDATE daily_reading_runs
      SET status = 'completed', source_snapshot = ?, document_id = ?, page_id = ?, completed_at = ?
      WHERE id = ?
    `).run(JSON.stringify(input.source), input.documentId, input.pageId, input.now, input.runId);
    this.connection.prepare(`
      UPDATE daily_reading_automations
      SET last_success_local_date = ?, updated_at = ? WHERE id = ?
    `).run(input.localDate, input.now, input.automationId);
    this.appendRunEvent({
      runId: input.runId,
      stage: "run.completed",
      level: "info",
      message: "Workflow 已完成并提交每日阅读 Page",
      data: { documentId: input.documentId, pageId: input.pageId },
      now: input.now,
    });
  }

  saveDocumentSource(input: {
    documentId: string;
    sourceId: string;
    sourceVersion: string;
    publisher: string;
    title: string;
    author: string | null;
    publishedAt: string | null;
    originalUrl: string;
    canonicalUrl: string;
    retrievedAt: string;
    attribution: string;
  }): void {
    this.connection.prepare(`
      INSERT INTO document_sources (
        document_id, source_id, source_version, publisher, source_title, author,
        published_at, original_url, canonical_url, retrieved_at, attribution_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.documentId, input.sourceId, input.sourceVersion, input.publisher, input.title,
      input.author, input.publishedAt, input.originalUrl, input.canonicalUrl,
      input.retrievedAt, input.attribution,
    );
  }

  sourceExists(canonicalUrl: string): boolean {
    return this.connection.prepare("SELECT 1 FROM document_sources WHERE canonical_url = ?")
      .get(canonicalUrl) !== undefined;
  }

  interruptRunning(now: string): void {
    const rows = this.connection.prepare(`
      SELECT id FROM daily_reading_runs WHERE status = 'running'
    `).all() as Array<{ id: string }>;
    for (const row of rows) {
      this.finishRun({
        runId: row.id,
        status: "interrupted",
        errorCode: "OPERATION_INTERRUPTED",
        errorMessage: "Local Service 重启前任务未完成",
        now,
      });
    }
  }

  private mapAutomation(row: AutomationRow): DailyReadingAutomation {
    const latest = this.connection.prepare(`
      SELECT * FROM daily_reading_runs WHERE automation_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(row.id) as unknown as RunRow | undefined;
    return {
      automationId: row.id,
      bookId: row.book_id,
      interestDescription: row.interest_description,
      interestProfile: parseJson<DailyReadingInterestProfile>(row.interest_profile_snapshot),
      localTime: row.local_time,
      timeZone: row.time_zone,
      enabled: row.enabled === 1,
      nextRunAt: row.next_run_at,
      lastAttemptAt: row.last_attempt_at,
      lastSuccessLocalDate: row.last_success_local_date,
      latestRun: latest === undefined ? null : mapRun(latest),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
