import { type ChangeEvent, useEffect, useState } from "react";
import { Link } from "react-router";

import type { DocumentSummary, HealthResponse } from "@lumen/api-contract";

import { waitForHealth } from "../api/health";
import { getDocuments, importMarkdown } from "../api/library";

type HealthState =
  | { status: "loading" }
  | { status: "ready"; health: HealthResponse }
  | { status: "error"; message: string };

export function LibraryPage() {
  const [healthState, setHealthState] = useState<HealthState>({ status: "loading" });
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    const fetchWithSignal = (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, signal: abortController.signal });

    void waitForHealth(fetchWithSignal)
      .then((health) => {
        setHealthState({ status: "ready", health });
        return getDocuments(fetchWithSignal)
          .then((loadedDocuments) => {
            setDocuments(loadedDocuments);
            setLibraryError(null);
          })
          .catch((error: unknown) => {
            if (!abortController.signal.aborted) {
              setLibraryError(error instanceof Error ? error.message : "无法加载文档库");
            }
          });
      })
      .catch((error: unknown) => {
        if (!abortController.signal.aborted) {
          setHealthState({
            status: "error",
            message: error instanceof Error ? error.message : "无法连接 Local Service",
          });
          setLibraryError("Local Service 尚未就绪，文档库暂时无法加载");
        }
      });

    return () => abortController.abort();
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(event.target.files?.[0] ?? null);
    setImportMessage(null);
  };

  const handleImport = async () => {
    if (selectedFile === null || isImporting) return;
    setIsImporting(true);
    setImportMessage(null);
    try {
      const result = await importMarkdown(selectedFile);
      setDocuments((current) => [result.document, ...current]);
      setSelectedFile(null);
      setImportMessage(`《${result.document.title}》已进入本地文档库`);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "文档导入失败");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Read. Understand. Remember.</p>
          <h1 id="lumen-title">Lumen</h1>
        </div>
        <div className={`service-status service-status--${healthState.status}`} role="status">
          {healthState.status === "loading" && "正在连接本地服务…"}
          {healthState.status === "error" && healthState.message}
          {healthState.status === "ready" && (
            <>
              <span className="status-dot" aria-hidden="true" />
              本地服务已连接 · DB {healthState.health.database.schemaVersion}
            </>
          )}
        </div>
        <Link className="library-nav-link" to="/learning">表达收藏</Link>
      </header>

      <section className="library-heading" aria-labelledby="library-title">
        <div>
          <p className="section-label">Local Library</p>
          <h2 id="library-title">你的阅读材料</h2>
          <p>文档只保存在这台设备中。MVP 当前支持 UTF-8 编码的 Markdown 文件。</p>
        </div>
        <div className="import-control">
          <label className="file-picker">
            <span>{selectedFile?.name ?? "选择 .md 文件"}</span>
            <input type="file" accept=".md,text/markdown" onChange={handleFileChange} />
          </label>
          <button type="button" disabled={selectedFile === null || isImporting} onClick={handleImport}>
            {isImporting ? "正在导入…" : "导入文档"}
          </button>
        </div>
      </section>

      {importMessage !== null && <p className="notice" role="status">{importMessage}</p>}
      {libraryError !== null && <p className="notice notice--error" role="alert">{libraryError}</p>}

      <section className="document-grid" aria-label="本地文档列表">
        {documents.length === 0 && libraryError === null ? (
          <div className="empty-library">
            <p className="empty-mark" aria-hidden="true">Aa</p>
            <h3>从一篇真实材料开始</h3>
            <p>导入 Markdown 后，它会在这里等待你继续阅读。</p>
          </div>
        ) : (
          documents.map((document) => (
            <Link className="document-card" key={document.documentId} to={`/reader/${document.documentId}`}>
              <div className="document-format">MD</div>
              <div>
                <h3>{document.title}</h3>
                <p>{document.originalFilename}</p>
              </div>
              <dl>
                <div><dt>大小</dt><dd>{formatBytes(document.byteSize)}</dd></div>
                <div><dt>导入时间</dt><dd>{formatDate(document.createdAt)}</dd></div>
              </dl>
              <span className="document-state">打开阅读 →</span>
            </Link>
          ))
        )}
      </section>
    </main>
  );
}

function formatBytes(byteSize: number): string {
  return byteSize < 1024 ? `${byteSize} B` : `${(byteSize / 1024).toFixed(1)} KiB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value));
}
