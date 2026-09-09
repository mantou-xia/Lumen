import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { App } from "./App";
import { LumenMuiThemeProvider } from "./app/mui-theme";
import { PreferencesProvider } from "./app/preferences";
import "./styles.css";
import "./app/theme.css";
import "./app/ui.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("缺少 Lumen 应用根节点");
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <PreferencesProvider>
        <LumenMuiThemeProvider>
          <App />
        </LumenMuiThemeProvider>
      </PreferencesProvider>
    </BrowserRouter>
  </StrictMode>,
);
