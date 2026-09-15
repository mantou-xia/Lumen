import { describe, expect, it } from "vitest";

import { closesFromPassiveDismiss } from "./useOverlayManager";

describe("Reader Overlay 被动关闭策略", () => {
  it("Workspace 只能显式关闭，其他临时浮层仍允许 Escape 或外部点击关闭", () => {
    expect(closesFromPassiveDismiss("workspace")).toBe(false);
    expect(closesFromPassiveDismiss("outline")).toBe(true);
    expect(closesFromPassiveDismiss("translation")).toBe(true);
    expect(closesFromPassiveDismiss("recall")).toBe(true);
  });
});
