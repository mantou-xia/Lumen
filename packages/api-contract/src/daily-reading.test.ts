import { describe, expect, it } from "vitest";

import {
  createDailyReadingBookRequestSchema,
  dailyReadingRunSchema,
  dailyReadingWorkflowTraceSchema,
} from "./daily-reading.js";

describe("Daily reading contracts", () => {
  it("接受自然语言目标、本地时间和 IANA 时区", () => {
    expect(createDailyReadingBookRequestSchema.parse({
      title: "AI Frontier",
      interestDescription: "I am an IELTS learner interested in AI and embodied intelligence.",
      localTime: "08:30",
      timeZone: "Asia/Shanghai",
    })).toMatchObject({ localTime: "08:30", timeZone: "Asia/Shanghai" });
  });

  it("拒绝无效的每日时间", () => {
    expect(createDailyReadingBookRequestSchema.safeParse({
      title: "AI Frontier",
      interestDescription: "I want a useful daily English technology article.",
      localTime: "25:00",
      timeZone: "Asia/Shanghai",
    }).success).toBe(false);
  });

  it("允许无内容作为正常终态", () => {
    expect(dailyReadingRunSchema.parse({
      runId: "run-1",
      automationId: "automation-1",
      status: "no_content",
      triggerReason: "scheduled",
      localDate: "2026-09-12",
      scheduledFor: "2026-09-12T00:00:00.000Z",
      source: null,
      documentId: null,
      pageId: null,
      errorCode: "DAILY_READING_NO_CONTENT",
      errorMessage: "No qualified content",
      createdAt: "2026-09-12T00:00:00.000Z",
      completedAt: "2026-09-12T00:00:01.000Z",
    }).status).toBe("no_content");
  });

  it("校验可关联 Runtime Trace 的 Workflow 执行链", () => {
    expect(dailyReadingWorkflowTraceSchema.parse({
      runId: "run-1",
      automationId: "automation-1",
      bookId: "book-1",
      bookTitle: "AI Frontier",
      operationId: "operation-1",
      status: "running",
      triggerReason: "initial",
      localDate: "2026-09-12",
      source: null,
      eventCount: 2,
      createdAt: "2026-09-12T00:00:00.000Z",
      completedAt: null,
      interestDescription: "An IELTS learner reading AI frontier news.",
      events: [
        {
          runId: "run-1",
          sequence: 1,
          stage: "run.requested",
          level: "info",
          message: "created",
          data: { operationId: "operation-1" },
          createdAt: "2026-09-12T00:00:00.000Z",
        },
        {
          runId: "run-1",
          sequence: 2,
          stage: "run.started",
          level: "info",
          message: "started",
          data: {},
          createdAt: "2026-09-12T00:00:01.000Z",
        },
      ],
    }).operationId).toBe("operation-1");
  });
});
