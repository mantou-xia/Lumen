import { z } from "zod";

export const readingSceneSchema = z.enum(["english_reading", "technical_learning"]);

export type ReadingScene = z.infer<typeof readingSceneSchema>;
