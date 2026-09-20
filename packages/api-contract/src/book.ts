import { z } from "zod";

import { documentFormatSchema, documentSummarySchema } from "./library.js";
import {
  readerDocumentSchema,
  readingProgressSchema,
  updateReadingProgressRequestSchema,
} from "./reader.js";

export const bookStatusSchema = z.enum(["ready", "archived"]);
export const bookPageOriginSchema = z.enum(["manual", "folder_import", "scheduled_reading"]);

export const bookSummarySchema = z.object({
  bookId: z.string().min(1),
  title: z.string().min(1),
  formatId: documentFormatSchema,
  status: bookStatusSchema,
  pageCount: z.number().int().nonnegative(),
  unreadAutoPageCount: z.number().int().nonnegative(),
  hasDailyReadingAutomation: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const bookPageSchema = z.object({
  pageId: z.string().min(1),
  order: z.number().int().nonnegative(),
  contentWeight: z.number().int().positive(),
  origin: bookPageOriginSchema,
  viewedAt: z.string().datetime().nullable(),
  document: documentSummarySchema,
});

export const bookDetailSchema = bookSummarySchema.extend({
  pages: z.array(bookPageSchema),
});

export const bookListResponseSchema = z.object({
  books: z.array(bookSummarySchema),
});

export const createBookRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  documentIds: z.array(z.string().min(1)).min(1),
});

export const reorderBookPagesRequestSchema = z.object({
  pageIds: z.array(z.string().min(1)).min(1),
});

export const readerBookQuerySchema = z.object({
  pageId: z.string().min(1).optional(),
});

export const bookReadingProgressSchema = readingProgressSchema.extend({
  bookId: z.string().min(1),
  pageId: z.string().min(1),
  pageProgression: z.number().min(0).max(1),
  bookProgression: z.number().min(0).max(1),
}).omit({ progression: true });

export const readerBookSchema = z.object({
  book: bookDetailSchema,
  activePageId: z.string().min(1),
  document: readerDocumentSchema,
  bookProgression: z.number().min(0).max(1),
});

export const updateBookReadingProgressRequestSchema = updateReadingProgressRequestSchema;

export type BookStatus = z.infer<typeof bookStatusSchema>;
export type BookPageOrigin = z.infer<typeof bookPageOriginSchema>;
export type BookSummary = z.infer<typeof bookSummarySchema>;
export type BookPage = z.infer<typeof bookPageSchema>;
export type BookDetail = z.infer<typeof bookDetailSchema>;
export type BookListResponse = z.infer<typeof bookListResponseSchema>;
export type CreateBookRequest = z.infer<typeof createBookRequestSchema>;
export type ReorderBookPagesRequest = z.infer<typeof reorderBookPagesRequestSchema>;
export type ReaderBookQuery = z.infer<typeof readerBookQuerySchema>;
export type ReaderBook = z.infer<typeof readerBookSchema>;
export type BookReadingProgress = z.infer<typeof bookReadingProgressSchema>;
export type UpdateBookReadingProgressRequest = z.infer<
  typeof updateBookReadingProgressRequestSchema
>;
