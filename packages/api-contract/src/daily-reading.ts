import { z } from "zod";

import { bookDetailSchema } from "./book.js";

export const dailyReadingRunStatusSchema = z.enum([
  "requested",
  "running",
  "completed",
  "no_content",
  "failed",
  "interrupted",
]);

export const dailyReadingTriggerReasonSchema = z.enum([
  "initial",
  "scheduled",
  "startup_catchup",
  "manual_retry",
]);

export const dailyReadingWorkflowEventLevelSchema = z.enum(["info", "warning", "error"]);

export const dailyReadingWorkflowStageSchema = z.enum([
  "run.requested",
  "run.started",
  "interest.completed",
  "sources.discovered",
  "candidates.ranked",
  "article.rejected",
  "article.selected",
  "document.imported",
  "page.appended",
  "run.completed",
  "run.no_content",
  "run.failed",
  "run.interrupted",
]);

export const dailyReadingInterestProfileSchema = z.object({
  learnerContext: z.string().trim().max(500),
  topics: z.array(z.string().trim().min(1).max(100)).max(12),
  readingGoal: z.string().trim().max(500),
  searchTerms: z.array(z.string().trim().min(1).max(100)).max(20),
});

export const dailyReadingSourceSnapshotSchema = z.object({
  sourceId: z.string().min(1),
  publisher: z.string().min(1),
  title: z.string().min(1),
  author: z.string().nullable(),
  publishedAt: z.string().datetime().nullable(),
  originalUrl: z.string().url(),
});

export const dailyReadingRunSchema = z.object({
  runId: z.string().min(1),
  automationId: z.string().min(1),
  status: dailyReadingRunStatusSchema,
  triggerReason: dailyReadingTriggerReasonSchema,
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  scheduledFor: z.string().datetime(),
  source: dailyReadingSourceSnapshotSchema.nullable(),
  documentId: z.string().nullable(),
  pageId: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export const dailyReadingAutomationSchema = z.object({
  automationId: z.string().min(1),
  bookId: z.string().min(1),
  interestDescription: z.string().trim().min(10).max(2000),
  interestProfile: dailyReadingInterestProfileSchema.nullable(),
  localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
  timeZone: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  nextRunAt: z.string().datetime(),
  lastAttemptAt: z.string().datetime().nullable(),
  lastSuccessLocalDate: z.string().nullable(),
  latestRun: dailyReadingRunSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const dailyReadingWorkflowEventSchema = z.object({
  runId: z.string().min(1),
  sequence: z.number().int().positive(),
  stage: dailyReadingWorkflowStageSchema,
  level: dailyReadingWorkflowEventLevelSchema,
  message: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const dailyReadingWorkflowTraceSummarySchema = z.object({
  runId: z.string().min(1),
  automationId: z.string().min(1),
  bookId: z.string().min(1),
  bookTitle: z.string().min(1),
  operationId: z.string().min(1).nullable(),
  status: dailyReadingRunStatusSchema,
  triggerReason: dailyReadingTriggerReasonSchema,
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  source: dailyReadingSourceSnapshotSchema.nullable(),
  eventCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export const dailyReadingWorkflowTraceSchema = dailyReadingWorkflowTraceSummarySchema.extend({
  interestDescription: z.string(),
  events: z.array(dailyReadingWorkflowEventSchema),
});

export const dailyReadingWorkflowTraceListSchema = z.object({
  traces: z.array(dailyReadingWorkflowTraceSummarySchema),
});

export const createDailyReadingBookRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  interestDescription: z.string().trim().min(10).max(2000),
  localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
  timeZone: z.string().trim().min(1).max(100),
});

export const createDailyReadingBookResponseSchema = z.object({
  book: bookDetailSchema,
  automation: dailyReadingAutomationSchema,
  run: dailyReadingRunSchema,
});

export const updateDailyReadingAutomationRequestSchema = z.object({
  interestDescription: z.string().trim().min(10).max(2000).optional(),
  localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u).optional(),
  timeZone: z.string().trim().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "至少需要更新一个自动化字段");

export type DailyReadingRunStatus = z.infer<typeof dailyReadingRunStatusSchema>;
export type DailyReadingTriggerReason = z.infer<typeof dailyReadingTriggerReasonSchema>;
export type DailyReadingWorkflowEventLevel = z.infer<typeof dailyReadingWorkflowEventLevelSchema>;
export type DailyReadingWorkflowStage = z.infer<typeof dailyReadingWorkflowStageSchema>;
export type DailyReadingInterestProfile = z.infer<typeof dailyReadingInterestProfileSchema>;
export type DailyReadingSourceSnapshot = z.infer<typeof dailyReadingSourceSnapshotSchema>;
export type DailyReadingRun = z.infer<typeof dailyReadingRunSchema>;
export type DailyReadingAutomation = z.infer<typeof dailyReadingAutomationSchema>;
export type DailyReadingWorkflowEvent = z.infer<typeof dailyReadingWorkflowEventSchema>;
export type DailyReadingWorkflowTraceSummary = z.infer<typeof dailyReadingWorkflowTraceSummarySchema>;
export type DailyReadingWorkflowTrace = z.infer<typeof dailyReadingWorkflowTraceSchema>;
export type CreateDailyReadingBookRequest = z.infer<typeof createDailyReadingBookRequestSchema>;
export type CreateDailyReadingBookResponse = z.infer<typeof createDailyReadingBookResponseSchema>;
export type UpdateDailyReadingAutomationRequest = z.infer<
  typeof updateDailyReadingAutomationRequestSchema
>;
