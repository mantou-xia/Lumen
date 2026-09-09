import { ThemeProvider, createTheme } from "@mui/material/styles";
import { useMemo, type ReactNode } from "react";

import { usePreferences } from "./preferences";

export function LumenMuiThemeProvider({ children }: { children: ReactNode }) {
  const { preferences } = usePreferences();
  const theme = useMemo(() => createTheme({
    cssVariables: {
      cssVarPrefix: "lumen-mui",
      nativeColor: true,
    },
    palette: {
      mode: preferences.colorTheme === "dark" ? "dark" : "light",
      primary: {
        main: "var(--ui-primary)",
        contrastText: "var(--ui-on-primary)",
      },
      secondary: { main: "var(--ui-accent)" },
      success: { main: "var(--ui-success)" },
      info: { main: "var(--ui-info)" },
      warning: { main: "var(--ui-warning)" },
      error: { main: "var(--ui-danger)" },
      background: {
        default: "var(--ui-bg)",
        paper: "var(--ui-surface)",
      },
      text: {
        primary: "var(--ui-text)",
        secondary: "var(--ui-muted)",
      },
      divider: "var(--ui-border)",
    },
    shape: { borderRadius: 6 },
    typography: {
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      button: { fontWeight: 600, textTransform: "none" },
    },
    components: {
      MuiButtonBase: {
        defaultProps: { disableRipple: true },
      },
      MuiButton: {
        defaultProps: { disableElevation: true, size: "small" },
        styleOverrides: {
          root: {
            borderRadius: 4,
            minHeight: 32,
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            border: "1px solid var(--ui-border)",
            boxShadow: "var(--ui-shadow)",
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none" },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          root: {
            color: "var(--ui-text)",
          },
          input: {
            "&::placeholder": {
              color: "var(--ui-subtle)",
              opacity: 1,
            },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            background: "var(--ui-surface)",
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: "var(--ui-border)",
            },
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: "var(--ui-border-strong)",
            },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: "var(--ui-primary)",
            },
          },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          switchBase: {
            color: "var(--ui-surface-raised)",
            "&.Mui-checked": {
              color: "var(--ui-primary)",
              "+ .MuiSwitch-track": {
                backgroundColor: "var(--ui-primary-soft)",
                borderColor: "var(--ui-primary)",
                opacity: 1,
              },
            },
          },
          thumb: {
            border: "1px solid var(--ui-border-strong)",
            boxShadow: "0 1px 4px rgb(0 0 0 / 22%)",
          },
          track: {
            backgroundColor: "var(--ui-surface-muted)",
            border: "1px solid var(--ui-border-strong)",
            boxSizing: "border-box",
            opacity: 1,
          },
        },
      },
    },
  }), [preferences.colorTheme]);

  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
