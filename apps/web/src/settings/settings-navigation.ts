export const SETTINGS_SECTION_IDS = [
  "appearance",
  "interaction",
  "network",
  "provider",
  "storage",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export interface SettingsSectionPosition {
  id: SettingsSectionId;
  top: number;
}

export function parseSettingsSectionHash(hash: string): SettingsSectionId {
  const candidate = hash.startsWith("#") ? hash.slice(1) : hash;
  return SETTINGS_SECTION_IDS.find((id) => id === candidate) ?? "appearance";
}

export function findActiveSettingsSection(
  positions: readonly SettingsSectionPosition[],
  activationLine: number,
  isAtBottom: boolean,
): SettingsSectionId {
  if (positions.length === 0) return "appearance";
  if (isAtBottom) return positions.at(-1)?.id ?? "appearance";

  let activeSection = positions[0]?.id ?? "appearance";
  for (const position of positions) {
    if (position.top > activationLine) break;
    activeSection = position.id;
  }
  return activeSection;
}
