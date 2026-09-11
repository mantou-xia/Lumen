import { describe, expect, it } from "vitest";

import {
  findActiveSettingsSection,
  parseSettingsSectionHash,
  type SettingsSectionPosition,
} from "./settings-navigation";

const positions: SettingsSectionPosition[] = [
  { id: "appearance", top: 120 },
  { id: "interaction", top: 640 },
  { id: "network", top: 980 },
  { id: "provider", top: 1500 },
  { id: "storage", top: 1880 },
];

describe("设置分区导航", () => {
  it("读取合法 Hash，并对非法 Hash 回退到阅读外观", () => {
    expect(parseSettingsSectionHash("#network")).toBe("network");
    expect(parseSettingsSectionHash("#storage")).toBe("storage");
    expect(parseSettingsSectionHash("#unknown")).toBe("appearance");
    expect(parseSettingsSectionHash("")).toBe("appearance");
  });

  it("选择已经越过顶部激活线的最后一个分区", () => {
    expect(findActiveSettingsSection(positions, 100, false)).toBe("appearance");
    expect(findActiveSettingsSection(positions, 700, false)).toBe("interaction");
    expect(findActiveSettingsSection(positions, 1499, false)).toBe("network");
  });

  it("滚动到容器底部时选择最后一个分区", () => {
    expect(findActiveSettingsSection(positions, 1600, true)).toBe("storage");
  });
});
