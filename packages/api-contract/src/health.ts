import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("lumen-local-service"),
  version: z.string().min(1),
  database: z.object({
    status: z.literal("ready"),
    schemaVersion: z.number().int().nonnegative(),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
