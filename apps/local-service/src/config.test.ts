import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("默认使用仓库根目录数据目录和 DeepSeek 预设", () => {
    const config = loadConfig({});
    expect(config.dataDirectory).toBe(resolve(import.meta.dirname, "../../..", ".lumen-data/development"));
    expect(config.port).toBe(4312);
    expect(config.modelProvider).toEqual({
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: null,
      model: "deepseek-v4-flash",
      requiresApiKey: true,
      disableThinking: true,
    });
  });

  it("DeepSeek 预设只需要填写 API Key", () => {
    expect(loadConfig({ LUMEN_AI_PRESET: "deepseek", LUMEN_AI_API_KEY: "secret" }).modelProvider)
      .toEqual({
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com",
        apiKey: "secret",
        model: "deepseek-v4-flash",
        requiresApiKey: true,
        disableThinking: true,
      });
  });

  it("允许通过环境变量覆盖数据目录和监听地址", () => {
    expect(
      loadConfig({
        LUMEN_DATA_DIR: "custom-data",
        LUMEN_HOST: "0.0.0.0",
        LUMEN_PORT: "5000",
        LUMEN_AI_BASE_URL: "http://127.0.0.1:11434/v1/",
        LUMEN_AI_MODEL: "local-model",
      }),
    ).toEqual({
      dataDirectory: resolve("custom-data"),
      host: "0.0.0.0",
      port: 5000,
      modelProvider: {
        providerId: "openai-compatible",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKey: null,
        model: "local-model",
        requiresApiKey: false,
        disableThinking: false,
      },
    });
  });

  it("拒绝非法端口", () => {
    expect(() => loadConfig({ LUMEN_PORT: "70000" })).toThrow(
      "LUMEN_PORT 必须是 1 到 65535 之间的整数",
    );
  });

  it("拒绝未知 Provider 预设", () => {
    expect(() => loadConfig({ LUMEN_AI_PRESET: "unknown" })).toThrow(
      "LUMEN_AI_PRESET 只能是 deepseek 或 openai-compatible",
    );
  });
});
