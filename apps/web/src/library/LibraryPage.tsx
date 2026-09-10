import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BookOpen,
  Clock3,
  Ellipsis,
  FileArchive,
  FileText,
  FileUp,
  LayoutGrid,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { Link } from "react-router";

import type { BookDetail, BookSummary, DocumentSummary } from "@lumen/api-contract";

import { createBook, getBook, getBooks, reorderBookPages } from "../api/book";
import { waitForHealth } from "../api/health";
import { getDocuments, importMarkdown } from "../api/library";
import { AppIcon } from "../app/AppIcon";
import { AppShell } from "../app/AppShell";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputBase,
  ScrollArea,
  StatusNotice,
  TextField,
} from "../app/ui";
import "./library.css";

type HealthState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

const coverThemes = ["slate", "amber", "rust", "navy", "cobalt", "denim"] as const;

export function LibraryPage() {
  const [healthState, setHealthState] = useState<HealthState>({ status: "loading" });
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [bookTitle, setBookTitle] = useState("");
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(() => new Set());
  const [isSavingBook, setIsSavingBook] = useState(false);
  const [manageBook, setManageBook] = useState<BookDetail | null>(null);
  const [managedPageIds, setManagedPageIds] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const abortController = new AbortController();
    const fetchWithSignal = (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, signal: abortController.signal });

    void waitForHealth(fetchWithSignal)
      .then(() => {
        setHealthState({ status: "ready" });
        return Promise.all([getDocuments(fetchWithSignal), getBooks(fetchWithSignal)])
          .then(([loadedDocuments, loadedBooks]) => {
            setDocuments(loadedDocuments);
            setBooks(loadedBooks);
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
  const visibleBooks = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    if (normalizedQuery.length === 0) return books;
    return books.filter((book) => book.title.toLocaleLowerCase().includes(normalizedQuery));
  }, [books, searchQuery]);

  const handleCreateBook = async () => {
    if (bookTitle.trim().length === 0 || selectedDocumentIds.size === 0 || isSavingBook) return;
    setIsSavingBook(true);
    try {
      const created = await createBook({
        title: bookTitle,
        documentIds: documents
          .filter((document) => selectedDocumentIds.has(document.documentId))
          .map((document) => document.documentId),
      });
      setBooks((current) => [created, ...current.filter((book) => book.bookId !== created.bookId)]);
      setCreateDialogOpen(false);
      setBookTitle("");
      setSelectedDocumentIds(new Set());
      setImportMessage(`Book《${created.title}》已创建，共 ${created.pageCount} 个 Page`);
    } catch (reason) {
      setImportMessage(reason instanceof Error ? reason.message : "Book 创建失败");
    } finally {
      setIsSavingBook(false);
    }
  };

  const handleOpenManageBook = async (bookId: string) => {
    try {
      const detail = await getBook(bookId);
      setManageBook(detail);
      setManagedPageIds(detail.pages.map((page) => page.pageId));
    } catch (reason) {
      setImportMessage(reason instanceof Error ? reason.message : "无法读取 Book 编排");
    }
  };

  const handleSavePageOrder = async () => {
    if (manageBook === null || isSavingBook) return;
    setIsSavingBook(true);
    try {
      const updated = await reorderBookPages(manageBook.bookId, { pageIds: managedPageIds });
      setBooks((current) => current.map((book) => (
        book.bookId === updated.bookId ? updated : book
      )));
      setManageBook(null);
      setImportMessage(`Book《${updated.title}》的 Page 顺序已保存`);
    } catch (reason) {
      setImportMessage(reason instanceof Error ? reason.message : "Page 顺序保存失败");
    } finally {
      setIsSavingBook(false);
    }
  };

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
                <InputBase
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  placeholder="搜索书目、主题或文件名…"
                  aria-label="搜索文档"
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
                {searchQuery.length > 0 && (
                  <IconButton label="清空搜索" onClick={() => setSearchQuery("")}>
                    <AppIcon icon={X} size={15} />
                  </IconButton>
                )}
              </label>
              <Button
                disabled={documents.length === 0}
                type="button"
                variant="secondary"
                onClick={() => setCreateDialogOpen(true)}
              ><AppIcon icon={Plus} size={17} />创建 Book</Button>
              <ImportControl isImporting={isImporting} onFileChange={handleFileChange} />
            </div>
          </header>

          <ScrollArea axis="x" className="library-filter-bar" aria-label="文档概览">
            <span className="is-active"><AppIcon icon={LayoutGrid} size={15} />全部材料 <strong>{documents.length + books.length}</strong></span>
            <span><AppIcon icon={BookOpen} size={15} />Book <strong>{books.length}</strong></span>
            <span><AppIcon icon={FileText} size={15} />Markdown <strong>{documents.length}</strong></span>
            <span className="library-sort"><AppIcon icon={ArrowUpDown} size={15} />按最近导入排序</span>
          </ScrollArea>

          {importMessage !== null && <StatusNotice className="library-notice">{importMessage}</StatusNotice>}
          {libraryError !== null && (
            <StatusNotice className="library-notice library-notice--error" tone="danger">
              <strong>文档库暂时无法加载</strong>
              <span>{healthState.status === "error" ? healthState.message : libraryError}</span>
            </StatusNotice>
          )}

          {libraryError === null && visibleBooks.length > 0 && (
            <section className="library-section" aria-labelledby="book-section-title">
              <header className="library-section-heading">
                <div><p className="library-kicker">Composed Reading</p><h2 id="book-section-title">Books</h2></div>
                <span>{visibleBooks.length} 本</span>
              </header>
              <div className="library-document-grid">
                {visibleBooks.map((book, index) => (
                  <BookCard
                    book={book}
                    index={index}
                    key={book.bookId}
                    onManage={() => void handleOpenManageBook(book.bookId)}
                  />
                ))}
              </div>
            </section>
          )}

          {libraryError === null && visibleDocuments.length > 0 && (
            <section className="library-section" aria-labelledby="document-section-title">
              <header className="library-section-heading">
                <div><p className="library-kicker">Source Documents</p><h2 id="document-section-title">独立文档</h2></div>
                <span>{visibleDocuments.length} 份</span>
              </header>
              <div className="library-document-grid" aria-label="本地文档列表">
                {visibleDocuments.map((document, index) => (
                  <DocumentCard document={document} index={index} key={document.documentId} />
                ))}
              </div>
            </section>
          )}

          {libraryError === null && documents.length === 0 && (
            <EmptyLibrary isDragging={isDragging} isImporting={isImporting} onFileChange={handleFileChange} />
          )}

          {libraryError === null && documents.length > 0 && visibleDocuments.length === 0 && visibleBooks.length === 0 && (
            <section className="library-empty-state library-empty-state--search" aria-labelledby="search-empty-title">
              <span className="library-empty-icon"><AppIcon icon={Search} size={34} /></span>
              <p className="library-kicker">No Matches</p>
              <h2 id="search-empty-title">没有找到相关文档</h2>
              <p>试试其他标题或文件名，当前搜索不会读取正文内容。</p>
              <Button type="button" variant="secondary" onClick={() => setSearchQuery("")}><AppIcon icon={X} size={15} />清除搜索</Button>
            </section>
          )}
        </div>

        {isDragging && documents.length > 0 && (
          <div className="library-drop-overlay" aria-hidden="true">
            <AppIcon icon={FileUp} size={38} /><strong>松开以导入 Markdown</strong>
          </div>
        )}
        <CreateBookDialog
          documents={documents}
          isSaving={isSavingBook}
          open={createDialogOpen}
          selectedDocumentIds={selectedDocumentIds}
          title={bookTitle}
          onClose={() => setCreateDialogOpen(false)}
          onCreate={() => void handleCreateBook()}
          onSelectedDocumentIdsChange={setSelectedDocumentIds}
          onTitleChange={setBookTitle}
        />
        <ManageBookDialog
          book={manageBook}
          isSaving={isSavingBook}
          pageIds={managedPageIds}
          onClose={() => setManageBook(null)}
          onPageIdsChange={setManagedPageIds}
          onSave={() => void handleSavePageOrder()}
        />
      </div>
    </AppShell>
  );
}

function BookCard({
  book,
  index,
  onManage,
}: {
  book: BookSummary;
  index: number;
  onManage: () => void;
}) {
  const theme = coverThemes[stableNumber(book.bookId) % coverThemes.length];
  const watermark = getWatermark(book.title);
  return (
    <article className="library-document-card library-book-card">
      <Link className={`library-document-cover library-document-cover--${theme}`} to={`/reader/books/${book.bookId}`}>
        <span className="library-document-format">BOOK</span>
        <span className="library-document-code">#{String(index + 1).padStart(3, "0")}–{watermark}B</span>
        <strong>{book.title}</strong>
        <span className="library-document-watermark" aria-hidden="true">{watermark}</span>
      </Link>
      <div className="library-document-details">
        <Link to={`/reader/books/${book.bookId}`}><h2>{book.title}</h2></Link>
        <p>{book.pageCount} 个 Markdown Page</p>
        <div className="library-document-meta">
          <span><AppIcon icon={BookOpen} size={14} />编排阅读</span>
          <span><AppIcon icon={Clock3} size={14} />{formatDate(book.updatedAt)}</span>
        </div>
        <div className="library-document-footer">
          <span>Book</span>
          <Button type="button" variant="ghost" onClick={onManage}>调整 Page 顺序</Button>
        </div>
      </div>
    </article>
  );
}

function CreateBookDialog({
  documents,
  isSaving,
  onClose,
  onCreate,
  onSelectedDocumentIdsChange,
  onTitleChange,
  open,
  selectedDocumentIds,
  title,
}: {
  documents: DocumentSummary[];
  isSaving: boolean;
  onClose: () => void;
  onCreate: () => void;
  onSelectedDocumentIdsChange: (value: Set<string>) => void;
  onTitleChange: (value: string) => void;
  open: boolean;
  selectedDocumentIds: Set<string>;
  title: string;
}) {
  return (
    <Dialog fullWidth maxWidth="sm" open={open} onClose={onClose}>
      <DialogTitle>创建 Markdown Book</DialogTitle>
      <DialogContent className="library-book-dialog">
        <TextField
          fullWidth
          label="Book 标题"
          margin="dense"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
        />
        <p>选择一份或多份文档。初始 Page 顺序与下列文档顺序一致，创建后可以调整。</p>
        <ScrollArea axis="y" className="library-book-document-list">
          {documents.map((document) => (
            <FormControlLabel
              control={<Checkbox checked={selectedDocumentIds.has(document.documentId)} />}
              key={document.documentId}
              label={document.title}
              onChange={(_, checked) => {
                const next = new Set(selectedDocumentIds);
                if (checked) next.add(document.documentId);
                else next.delete(document.documentId);
                onSelectedDocumentIdsChange(next);
              }}
            />
          ))}
        </ScrollArea>
      </DialogContent>
      <DialogActions>
        <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
        <Button
          disabled={title.trim().length === 0 || selectedDocumentIds.size === 0 || isSaving}
          type="button"
          onClick={onCreate}
        >{isSaving ? "正在创建…" : "创建 Book"}</Button>
      </DialogActions>
    </Dialog>
  );
}

function ManageBookDialog({
  book,
  isSaving,
  onClose,
  onPageIdsChange,
  onSave,
  pageIds,
}: {
  book: BookDetail | null;
  isSaving: boolean;
  onClose: () => void;
  onPageIdsChange: (value: string[]) => void;
  onSave: () => void;
  pageIds: string[];
}) {
  const pages = pageIds.map((pageId) => book?.pages.find((page) => page.pageId === pageId)).filter(
    (page): page is BookDetail["pages"][number] => page !== undefined,
  );
  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= pageIds.length) return;
    const next = [...pageIds];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onPageIdsChange(next);
  };
  return (
    <Dialog fullWidth maxWidth="sm" open={book !== null} onClose={onClose}>
      <DialogTitle>调整《{book?.title}》的 Page 顺序</DialogTitle>
      <DialogContent className="library-book-dialog">
        <p>顺序会直接决定 Book 目录、上一页/下一页和整本阅读进度。</p>
        <ol className="library-page-order-list">
          {pages.map((page, index) => (
            <li key={page.pageId}>
              <span>{index + 1}</span><strong>{page.document.title}</strong>
              <IconButton disabled={index === 0} label={`上移 ${page.document.title}`} onClick={() => move(index, -1)}>
                <AppIcon icon={ArrowUp} size={16} />
              </IconButton>
              <IconButton disabled={index === pages.length - 1} label={`下移 ${page.document.title}`} onClick={() => move(index, 1)}>
                <AppIcon icon={ArrowDown} size={16} />
              </IconButton>
            </li>
          ))}
        </ol>
      </DialogContent>
      <DialogActions>
        <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
        <Button disabled={isSaving} type="button" onClick={onSave}>{isSaving ? "正在保存…" : "保存顺序"}</Button>
      </DialogActions>
    </Dialog>
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
