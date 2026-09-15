import { z } from "zod";

import { bookDetailSchema } from "./book.js";
import { documentSummarySchema } from "./library.js";

export const folderImportManifestSchema = z.object({
  folderName: z.string().trim().min(1).max(200),
  paths: z.array(z.string().min(1)).min(1).max(2000),
});

export const importMarkdownFolderResponseSchema = z.object({
  book: bookDetailSchema,
  documents: z.array(documentSummarySchema).min(1),
});

export type FolderImportManifest = z.infer<typeof folderImportManifestSchema>;
export type ImportMarkdownFolderResponse = z.infer<typeof importMarkdownFolderResponseSchema>;
