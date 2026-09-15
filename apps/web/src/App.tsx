import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";

import { LibraryPage } from "./library/LibraryPage";
import { ExpressionDetailPage } from "./learning-library/ExpressionDetailPage";
import { LearningLibraryPage } from "./learning-library/LearningLibraryPage";
import { ReaderPage } from "./reader/ReaderPage";
import { SettingsPage } from "./settings/SettingsPage";

const AgentTestPage = import.meta.env.VITE_AGENT_TEST === "true"
  ? lazy(async () => import("./developer/AgentTestPage").then((module) => ({ default: module.AgentTestPage })))
  : null;

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LibraryPage />} />
      <Route path="/reader/:documentId" element={<ReaderPage />} />
      <Route path="/reader/books/:bookId" element={<ReaderPage />} />
      <Route path="/learning" element={<LearningLibraryPage />} />
      <Route path="/learning/:expressionId" element={<ExpressionDetailPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      {AgentTestPage !== null && <Route path="/dev/agent-test" element={<Suspense fallback={null}><AgentTestPage /></Suspense>} />}
    </Routes>
  );
}
