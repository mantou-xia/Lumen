import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../infrastructure/database/database.js";
import { DailyReadingRepository } from "./daily-reading-repository.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("DailyReadingRepository workflow trace", () => {
  it("按顺序持久化并查询一次运行的 Workflow 阶段", () => {
    const directory = mkdtempSync(join(tmpdir(), "lumen-daily-reading-trace-"));
    temporaryDirectories.push(directory);
    const database = openDatabase(join(directory, "lumen.db"));
    const repository = new DailyReadingRepository(database.connection);
    const now = "2026-09-12T00:00:00.000Z";

    database.connection.prepare(`
      INSERT INTO books (id, title, format_id, status, created_at, updated_at)
      VALUES ('book-1', 'AI Frontier', 'markdown', 'ready', ?, ?)
    `).run(now, now);
    database.connection.prepare(`
      INSERT INTO operations (
        id, task_type, task_version, status, document_id, revision_id,
        context_snapshot, created_at, updated_at
      ) VALUES (
        'operation-1', 'daily-reading.workflow', 'daily-reading.workflow.v1',
        'requested', NULL, NULL, '{}', ?, ?
      )
    `).run(now, now);
    repository.createAutomation({
      automationId: "automation-1",
      bookId: "book-1",
      interestDescription: "An IELTS learner reading AI frontier news.",
      localTime: "08:00",
      timeZone: "Asia/Shanghai",
      nextRunAt: "2026-09-13T00:00:00.000Z",
      now,
    });
    repository.createRun({
      runId: "run-1",
      automationId: "automation-1",
      operationId: "operation-1",
      triggerReason: "initial",
      scheduledFor: now,
      localDate: "2026-09-12",
      now,
    });
    repository.markRunning(
      "run-1",
      "2026-09-13T00:00:00.000Z",
      "2026-09-12T00:00:01.000Z",
    );
    repository.appendRunEvent({
      runId: "run-1",
      stage: "sources.discovered",
      level: "info",
      message: "发现 2 个候选",
      data: { candidateCount: 2 },
      now: "2026-09-12T00:00:02.000Z",
    });
    repository.finishRun({
      runId: "run-1",
      status: "no_content",
      errorCode: "DAILY_READING_NO_CONTENT",
      errorMessage: "候选均未通过校验",
      now: "2026-09-12T00:00:03.000Z",
    });

    expect(repository.listWorkflowTraces({ limit: 50 }).traces).toEqual([expect.objectContaining({
      runId: "run-1",
      operationId: "operation-1",
      bookTitle: "AI Frontier",
      status: "no_content",
      eventCount: 4,
    })]);
    expect(repository.getWorkflowTrace("run-1")).toMatchObject({
      interestDescription: "An IELTS learner reading AI frontier news.",
      events: [
        { sequence: 1, stage: "run.requested" },
        { sequence: 2, stage: "run.started" },
        { sequence: 3, stage: "sources.discovered", data: { candidateCount: 2 } },
        { sequence: 4, stage: "run.no_content", level: "warning" },
      ],
    });
    database.close();
  });
});
