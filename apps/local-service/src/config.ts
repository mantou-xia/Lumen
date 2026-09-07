import { resolve } from "node:path";

const defaultDataDirectory = resolve(import.meta.dirname, "../../..", ".lumen-data/development");
const deepSeekBaseUrl = "https://api.deepseek.com";
const deepSeekModel = "deepseek-v4-flash";

export type ModelProviderPreset = "deepseek" | "openai-compatible";

export interface ModelProviderConfig {
  providerId: ModelProviderPreset;
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  requiresApiKey: boolean;
  disableThinking: boolean;
}

export interface LocalServiceConfig {
  dataDirectory: string;
  host: string;
  port: number;
  modelProvider: ModelProviderConfig;
}

function optionalValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? null : normalized;
}

function resolveProviderPreset(environment: NodeJS.ProcessEnv): ModelProviderPreset {
  const configuredPreset = optionalValue(environment.LUMEN_AI_PRESET);
  if (configuredPreset === "deepseek" || configuredPreset === "openai-compatible") {
    return configuredPreset;
  }
  if (configuredPreset !== null) {
    throw new Error("LUMEN_AI_PRESET 只能是 deepseek 或 openai-compatible");
  }
  return optionalValue(environment.LUMEN_AI_BASE_URL) !== null ||
    optionalValue(environment.LUMEN_AI_MODEL) !== null
    ? "openai-compatible"
    : "deepseek";
}

function resolveModelProvider(environment: NodeJS.ProcessEnv): ModelProviderConfig {
  const providerId = resolveProviderPreset(environment);
  const apiKey = optionalValue(environment.LUMEN_AI_API_KEY);
  if (providerId === "deepseek") {
    return {
      providerId,
      baseUrl: deepSeekBaseUrl,
      apiKey,
      model: deepSeekModel,
      requiresApiKey: true,
      disableThinking: true,
    };
  }
  return {
    providerId,
    baseUrl: optionalValue(environment.LUMEN_AI_BASE_URL)?.replace(/\/$/, "") ?? null,
    apiKey,
    model: optionalValue(environment.LUMEN_AI_MODEL),
    requiresApiKey: false,
    disableThinking: false,
  };
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 4312;
  }

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("LUMEN_PORT 必须是 1 到 65535 之间的整数");
  }

  return port;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): LocalServiceConfig {
  return {
    dataDirectory:
      environment.LUMEN_DATA_DIR === undefined
        ? defaultDataDirectory
        : resolve(environment.LUMEN_DATA_DIR),
    host: environment.LUMEN_HOST ?? "127.0.0.1",
    port: parsePort(environment.LUMEN_PORT),
    modelProvider: resolveModelProvider(environment),
  };
}
