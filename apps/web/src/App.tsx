import { Route, Routes } from "react-router";

import { LibraryPage } from "./library/LibraryPage";
import { LearningLibraryPage } from "./learning-library/LearningLibraryPage";
import { ReaderPage } from "./reader/ReaderPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LibraryPage />} />
      <Route path="/reader/:documentId" element={<ReaderPage />} />
      <Route path="/learning" element={<LearningLibraryPage />} />
    </Routes>
  );
}
