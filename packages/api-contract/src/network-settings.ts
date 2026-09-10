import { z } from "zod";

export const networkRouteModeSchema = z.enum(["auto", "direct", "manual"]);
export const proxyProtocolSchema = z.enum(["http", "https"]);

export const networkSettingsSchema = z.object({
  mode: networkRouteModeSchema,
  proxyProtocol: proxyProtocolSchema,
  proxyHost: z.string().trim().min(1).max(253).regex(/^[a-z\d.-]+$/iu),
  proxyPort: z.number().int().min(1).max(65_535),
});

export const updateNetworkSettingsRequestSchema = networkSettingsSchema;

export const networkRouteStatusSchema = z.object({
  settings: networkSettingsSchema,
  activeRoute: z.enum(["direct", "proxy"]),
  candidateProxyUrl: z.string().url().nullable(),
  proxyReachable: z.boolean(),
  proxySource: z.enum(["manual", "environment", "system"]).nullable(),
});

export type NetworkRouteMode = z.infer<typeof networkRouteModeSchema>;
export type NetworkSettings = z.infer<typeof networkSettingsSchema>;
export type NetworkRouteStatus = z.infer<typeof networkRouteStatusSchema>;
export type ProxyProtocol = z.infer<typeof proxyProtocolSchema>;
export type UpdateNetworkSettingsRequest = z.infer<typeof updateNetworkSettingsRequestSchema>;
