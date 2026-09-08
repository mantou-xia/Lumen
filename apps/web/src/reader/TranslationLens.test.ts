import { describe, expect, it } from "vitest";

import { calculateLensPosition } from "./TranslationLens";

describe("Translation Lens 定位", () => {
  it("下方空间不足时放在选区上方且不遮挡选区", () => {
    const position = calculateLensPosition({
      anchor: {
        bounds: { top: 600, right: 400, bottom: 620, left: 300 },
        scrollX: 0,
        scrollY: 0,
      },
      elementWidth: 360,
      elementHeight: 400,
      viewportWidth: 900,
      viewportHeight: 700,
      scrollX: 0,
      scrollY: 0,
    });

    expect(position.top).toBe(190);
    expect(position.top + 400).toBeLessThan(600);
  });

  it("窄窗口中限制在视口边界内", () => {
    const position = calculateLensPosition({
      anchor: {
        bounds: { top: 40, right: 350, bottom: 60, left: 330 },
        scrollX: 0,
        scrollY: 0,
      },
      elementWidth: 360,
      elementHeight: 300,
      viewportWidth: 390,
      viewportHeight: 700,
      scrollX: 0,
      scrollY: 0,
    });

    expect(position.left).toBe(16);
    expect(position.top).toBe(70);
  });

  it("滚动后按原选区的文档位置重算", () => {
    const position = calculateLensPosition({
      anchor: {
        bounds: { top: 300, right: 300, bottom: 320, left: 120 },
        scrollX: 0,
        scrollY: 100,
      },
      elementWidth: 300,
      elementHeight: 200,
      viewportWidth: 900,
      viewportHeight: 700,
      scrollX: 0,
      scrollY: 180,
    });

    expect(position).toEqual({ top: 250, left: 120 });
  });
});
