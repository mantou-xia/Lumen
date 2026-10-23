import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ColorTheme = "light" | "sepia" | "dark";
export type ReadingWidth = 680 | 760 | 840;
export type ReadingFontSize = 16 | 18 | 20;
export type ReadingLineHeight = 1.6 | 1.75 | 1.9;
export type ReferenceCaptureMode = "single" | "continuous";
export interface RgbColor { r: number; g: number; b: number }

export interface UiPreferences {
  colorTheme: ColorTheme;
  readingWidth: ReadingWidth;
  readingFontSize: ReadingFontSize;
  readingLineHeight: ReadingLineHeight;
  autoTranslateSelection: boolean;
  recallEnabled: boolean;
  referenceCaptureMode: ReferenceCaptureMode;
  translationHighlightRgb: RgbColor;
  explanationHighlightRgb: RgbColor;
  enableParagraphIndent: boolean;
}

interface PreferencesContextValue {
  preferences: UiPreferences;
  updatePreferences: (patch: Partial<UiPreferences>) => void;
  resetPreferences: () => void;
}

const storageKey = "lumen.ui.preferences.v1";

function systemTheme(): ColorTheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function defaultPreferences(): UiPreferences {
  return {
    colorTheme: systemTheme(),
    readingWidth: 760,
    readingFontSize: 18,
    readingLineHeight: 1.75,
    autoTranslateSelection: true,
    recallEnabled: true,
    referenceCaptureMode: "single",
    translationHighlightRgb: { r: 81, g: 125, b: 161 },
    explanationHighlightRgb: { r: 126, g: 87, b: 194 },
    enableParagraphIndent: true,
  };
}

function loadPreferences(): UiPreferences {
  const defaults = defaultPreferences();
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === null) return defaults;
    const parsed = JSON.parse(stored) as Partial<UiPreferences>;
    return {
      ...defaults,
      ...parsed,
      translationHighlightRgb: normalizeRgb(parsed.translationHighlightRgb, defaults.translationHighlightRgb),
      explanationHighlightRgb: normalizeRgb(parsed.explanationHighlightRgb, defaults.explanationHighlightRgb),
    };
  } catch {
    return defaults;
  }
}

export function normalizeRgb(value: unknown, fallback: RgbColor): RgbColor {
  const candidate = typeof value === "object" && value !== null
    ? value as Partial<RgbColor>
    : {};
  const channel = (candidate: unknown, defaultValue: number) => (
    typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.min(255, Math.max(0, Math.round(candidate)))
      : defaultValue
  );
  return {
    r: channel(candidate.r, fallback.r),
    g: channel(candidate.g, fallback.g),
    b: channel(candidate.b, fallback.b),
  };
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<UiPreferences>(loadPreferences);

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.colorTheme;
    document.documentElement.style.colorScheme =
      preferences.colorTheme === "dark" ? "dark" : "light";
    window.localStorage.setItem(storageKey, JSON.stringify(preferences));
  }, [preferences]);

  const value = useMemo<PreferencesContextValue>(() => ({
    preferences,
    updatePreferences: (patch) => setPreferences((current) => ({ ...current, ...patch })),
    resetPreferences: () => setPreferences(defaultPreferences()),
  }), [preferences]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext);
  if (value === null) throw new Error("usePreferences 必须在 PreferencesProvider 内使用");
  return value;
}
