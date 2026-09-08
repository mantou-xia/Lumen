import { Route, Routes } from "react-router";

import { LibraryPage } from "./library/LibraryPage";
import { ExpressionDetailPage } from "./learning-library/ExpressionDetailPage";
import { LearningLibraryPage } from "./learning-library/LearningLibraryPage";
import { ReaderPage } from "./reader/ReaderPage";
import { SettingsPage } from "./settings/SettingsPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LibraryPage />} />
      <Route path="/reader/:documentId" element={<ReaderPage />} />
      <Route path="/learning" element={<LearningLibraryPage />} />
      <Route path="/learning/:expressionId" element={<ExpressionDetailPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  );
}
