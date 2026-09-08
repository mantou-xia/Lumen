import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowUpDown,
  Clock3,
  Ellipsis,
  FileArchive,
  FileText,
  FileUp,
  LayoutGrid,
  LoaderCircle,
  Search,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { Link } from "react-router";

import type { DocumentSummary } from "@lumen/api-contract";

import { waitForHealth } from "../api/health";
import { getDocuments, importMarkdown } from "../api/library";
import { AppIcon } from "../app/AppIcon";
import { AppShell } from "../app/AppShell";
import { StatusNotice } from "../app/ui";
import "./library.css";

type HealthState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

const coverThemes = ["slate", "amber", "rust", "navy", "cobalt", "denim"] as const;

export function LibraryPage() {
  const [healthState, setHealthState] = useState<HealthState>({ status: "loading" });
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const abortController = new AbortController();
    const fetchWithSignal = (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, signal: abortController.signal });

    void waitForHealth(fetchWithSignal)
      .then(() => {
        setHealthState({ status: "ready" });
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

  const visibleDocuments = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    if (normalizedQuery.length === 0) return documents;
    return documents.filter((document) =>
      `${document.title} ${document.originalFilename}`
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );
  }, [documents, searchQuery]);

  const importFile = async (file: File) => {
    if (isImporting) return;
    if (!isMarkdownFile(file)) {
      setImportMessage("当前仅支持 UTF-8 编码的 Markdown 文件");
      return;
    }

    setIsImporting(true);
    setImportMessage(null);
    try {
      const result = await importMarkdown(file);
      setDocuments((current) => [
        result.document,
        ...current.filter((document) => document.documentId !== result.document.documentId),
      ]);
      setImportMessage(`《${result.document.title}》已进入本地文档库`);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "文档导入失败");
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file !== undefined) void importFile(file);
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file !== undefined) void importFile(file);
  };

  return (
    <AppShell
      activeSection="library"
      onQuickSearch={() => searchInputRef.current?.focus()}
      quickSearchLabel="快速检索文献"
      workspaceLabel="Markdown Library"
    >
      <div
        className="library-page-root"
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes("Files")) setIsDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
        }}
        onDrop={handleDrop}
      >
        <div className="library-page-content">
          <header className="library-page-heading">
            <div>
              <p className="library-kicker">Lumen Archive <span /> Local First</p>
              <h1 id="library-title">你的阅读材料</h1>
              <p className="library-description"><AppIcon icon={ShieldCheck} size={16} />文档只保存在当前设备，离线可用且尊重隐私边界</p>
            </div>
            <div className="library-heading-actions">
              <label className="library-search">
                <AppIcon icon={Search} size={16} />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  placeholder="搜索书目、主题或文件名…"
                  aria-label="搜索文档"
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
                {searchQuery.length > 0 && (
                  <button type="button" onClick={() => setSearchQuery("")} aria-label="清空搜索" title="清空搜索">
                    <AppIcon icon={X} size={15} />
                  </button>
                )}
              </label>
              <ImportControl isImporting={isImporting} onFileChange={handleFileChange} />
            </div>
          </header>

          <div className="library-filter-bar" aria-label="文档概览">
            <span className="is-active"><AppIcon icon={LayoutGrid} size={15} />全部文档 <strong>{documents.length}</strong></span>
            <span><AppIcon icon={FileText} size={15} />Markdown <strong>{documents.length}</strong></span>
            <span className="library-sort"><AppIcon icon={ArrowUpDown} size={15} />按最近导入排序</span>
          </div>

          {importMessage !== null && <StatusNotice className="library-notice">{importMessage}</StatusNotice>}
          {libraryError !== null && (
            <StatusNotice className="library-notice library-notice--error" tone="danger">
              <strong>文档库暂时无法加载</strong>
              <span>{healthState.status === "error" ? healthState.message : libraryError}</span>
            </StatusNotice>
          )}

          {libraryError === null && visibleDocuments.length > 0 && (
            <section className="library-document-grid" aria-label="本地文档列表">
              {visibleDocuments.map((document, index) => (
                <DocumentCard document={document} index={index} key={document.documentId} />
              ))}
            </section>
          )}

          {libraryError === null && documents.length === 0 && (
            <EmptyLibrary isDragging={isDragging} isImporting={isImporting} onFileChange={handleFileChange} />
          )}

          {libraryError === null && documents.length > 0 && visibleDocuments.length === 0 && (
            <section className="library-empty-state library-empty-state--search" aria-labelledby="search-empty-title">
              <span className="library-empty-icon"><AppIcon icon={Search} size={34} /></span>
              <p className="library-kicker">No Matches</p>
              <h2 id="search-empty-title">没有找到相关文档</h2>
              <p>试试其他标题或文件名，当前搜索不会读取正文内容。</p>
              <button type="button" onClick={() => setSearchQuery("")}><AppIcon icon={X} size={15} />清除搜索</button>
            </section>
          )}
        </div>

        {isDragging && documents.length > 0 && (
          <div className="library-drop-overlay" aria-hidden="true">
            <AppIcon icon={FileUp} size={38} /><strong>松开以导入 Markdown</strong>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ImportControl({
  isImporting,
  onFileChange,
}: {
  isImporting: boolean;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className={`library-import-button${isImporting ? " is-loading" : ""}`}>
      <AppIcon className={isImporting ? "is-spinning" : undefined} icon={isImporting ? LoaderCircle : Upload} size={17} />
      <span>{isImporting ? "正在导入" : "导入文档"}</span>
      <input type="file" accept=".md,text/markdown" disabled={isImporting} onChange={onFileChange} />
    </label>
  );
}

function DocumentCard({ document, index }: { document: DocumentSummary; index: number }) {
  const theme = coverThemes[stableNumber(document.documentId) % coverThemes.length];
  const coverCode = String(index + 1).padStart(3, "0");
  const watermark = getWatermark(document.title);

  return (
    <article className="library-document-card">
      <Link className={`library-document-cover library-document-cover--${theme}`} to={`/reader/${document.documentId}`}>
        <span className="library-document-format">MD</span>
        <span className="library-document-code">#{coverCode}–{watermark}R</span>
        <strong>{document.title}</strong>
        <span className="library-document-watermark" aria-hidden="true">{watermark}</span>
      </Link>
      <div className="library-document-details">
        <Link to={`/reader/${document.documentId}`}><h2>{document.title}</h2></Link>
        <p title={document.originalFilename}>{document.originalFilename}</p>
        <div className="library-document-meta">
          <span><AppIcon icon={FileArchive} size={14} />{formatBytes(document.byteSize)}</span>
          <span><AppIcon icon={Clock3} size={14} />{formatDate(document.createdAt)}</span>
        </div>
        <div className="library-document-footer">
          <span>本地文档</span><span aria-label="更多操作"><AppIcon icon={Ellipsis} size={17} /></span>
        </div>
      </div>
    </article>
  );
}

function EmptyLibrary({
  isDragging,
  isImporting,
  onFileChange,
}: {
  isDragging: boolean;
  isImporting: boolean;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <section className={`library-empty-state${isDragging ? " is-dragging" : ""}`} aria-labelledby="empty-library-title">
      <span className="library-empty-icon"><AppIcon icon={FileText} size={34} /></span>
      <p className="library-kicker">Your Local Archive</p>
      <h2 id="empty-library-title">从一篇真实材料开始</h2>
      <p>导入 Markdown 文档，Lumen 会在本地保留原文、阅读位置和学习语境。</p>
      <ImportControl isImporting={isImporting} onFileChange={onFileChange} />
      <small><AppIcon icon={FileUp} size={14} />也可以将 .md 文件拖放到这里</small>
    </section>
  );
}

function isMarkdownFile(file: File): boolean {
  return file.name.toLocaleLowerCase().endsWith(".md") || file.type === "text/markdown";
}

function stableNumber(value: string): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

function getWatermark(title: string): string {
  return title.match(/[a-z0-9]/i)?.[0]?.toLocaleUpperCase() ?? "L";
}

function formatBytes(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KiB`;
  return `${(byteSize / 1024 / 1024).toFixed(1)} MiB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value));
}
