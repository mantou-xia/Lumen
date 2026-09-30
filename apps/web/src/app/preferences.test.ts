import { describe, expect, it } from "vitest";

import { normalizeRgb } from "./preferences";

describe("阅读辅助结果颜色偏好", () => {
  const fallback = { r: 81, g: 125, b: 161 };

  it("把持久化 RGB 通道归一化到 0～255 的整数", () => {
    expect(normalizeRgb({ r: -4, g: 127.6, b: 300 }, fallback)).toEqual({
      r: 0,
      g: 128,
      b: 255,
    });
  });

  it("非法结构与非法通道回退到默认颜色", () => {
    expect(normalizeRgb("invalid", fallback)).toEqual(fallback);
    expect(normalizeRgb({ r: Number.NaN, g: 64 }, fallback)).toEqual({
      r: fallback.r,
      g: 64,
      b: fallback.b,
    });
  });
});
