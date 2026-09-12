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
  FolderUp,
  LayoutGrid,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { Link } from "react-router";

import type {
  BookDetail,
  BookSummary,
  DailyReadingAutomation,
  DocumentSummary,
} from "@lumen/api-contract";

import { createBook, getBook, getBooks, reorderBookPages } from "../api/book";
import {
  createDailyReadingBook,
  getDailyReadingAutomation,
  retryDailyReading,
  updateDailyReadingAutomation,
} from "../api/daily-reading";
import { waitForHealth } from "../api/health";
import { getDocuments, importMarkdown, importMarkdownFolder } from "../api/library";
import { AppIcon } from "../app/AppIcon";
import { AppShell } from "../app/AppShell";
import {
  Button,
  ButtonBase,
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
  Switch,
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
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [dailyDialogOpen, setDailyDialogOpen] = useState(false);
  const [dailyInterest, setDailyInterest] = useState("");
  const [dailyTime, setDailyTime] = useState("08:00");
  const [bookTitle, setBookTitle] = useState("");
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(() => new Set());
  const [isSavingBook, setIsSavingBook] = useState(false);
  const [manageBook, setManageBook] = useState<BookDetail | null>(null);
  const [manageAutomation, setManageAutomation] = useState<DailyReadingAutomation | null>(null);
  const [managedPageIds, setManagedPageIds] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (healthState.status !== "ready") return;
    const timer = window.setInterval(() => {
      void getBooks().then(setBooks).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [healthState.status]);

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

  const handleCreateDailyBook = async () => {
    if (bookTitle.trim().length === 0 || dailyInterest.trim().length < 10 || isSavingBook) return;
    setIsSavingBook(true);
    try {
      const created = await createDailyReadingBook({
        title: bookTitle,
        interestDescription: dailyInterest,
        localTime: dailyTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setBooks((current) => [created.book, ...current.filter((book) => book.bookId !== created.book.bookId)]);
      setDailyDialogOpen(false);
      setBookTitle("");
      setDailyInterest("");
      setImportMessage(`每日阅读 Book《${created.book.title}》已创建，正在寻找首篇材料`);
    } catch (reason) {
      setImportMessage(reason instanceof Error ? reason.message : "每日阅读 Book 创建失败");
    } finally {
      setIsSavingBook(false);
    }
  };

  const handleOpenAutomation = async (bookId: string) => {
    try {
      setManageAutomation(await getDailyReadingAutomation(bookId));
    } catch (reason) {
      setImportMessage(reason instanceof Error ? reason.message : "无法读取每日阅读配置");
    }
  };

  const handleSaveAutomation = async () => {
    if (manageAutomation === null || isSavingBook) return;
    setIsSavingBook(true);
    try {
      const updated = await updateDailyReadingAutomation(manageAutomation.bookId, {
        interestDescription: manageAutomation.interestDescription,
        localTime: manageAutomation.localTime,
        timeZone: manageAutomation.timeZone,
        enabled: manageAutomation.enabled,
      });
      setManageAutomation(updated);
      setImportMessage("每日阅读配置已保存");
    } catch (reason) {
      setImportMessage(reason instanceof Error ? reason.message : "每日阅读配置保存失败");
    } finally {
      setIsSavingBook(false);
    }
  };

  const handleRetryAutomation = async () => {
    if (manageAutomation === null || isSavingBook) return;
    setIsSavingBook(true);
    try {
      await retryDailyReading(manageAutomation.bookId);
      setManageAutomation(await getDailyReadingAutomation(manageAutomation.bookId));
      setImportMessage("已重新开始寻找今天的阅读材料");
    } catch (reason) {
      setImportMessage(reason instanceof Error ? reason.message : "每日阅读重试失败");
    } finally {
      setIsSavingBook(false);
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

  const handleFolderChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = [...(event.target.files ?? [])];
    event.target.value = "";
    if (selectedFiles.length === 0 || isImporting) return;
    const firstPath = selectedFiles[0]!.webkitRelativePath.replaceAll("\\", "/");
    const folderName = firstPath.split("/")[0]?.trim() ?? "";
    const supportedFiles = selectedFiles
      .filter((file) => /\.(?:md|png|jpe?g|gif|webp|avif|svg)$/iu.test(file.name))
      .map((file) => ({
        file,
        relativePath: file.webkitRelativePath.replaceAll("\\", "/").split("/").slice(1).join("/"),
      }));
    if (folderName.length === 0 || !supportedFiles.some((entry) => isMarkdownFile(entry.file))) {
      setImportMessage("所选文件夹中没有可导入的 Markdown 文件");
      return;
    }
    setFolderDialogOpen(false);
    setIsImporting(true);
    setImportMessage(null);
    void importMarkdownFolder(folderName, supportedFiles)
      .then((result) => {
        setDocuments((current) => [
          ...result.documents,
          ...current.filter((document) => !result.documents.some(
            (imported) => imported.documentId === document.documentId,
          )),
        ]);
        setBooks((current) => [
          result.book,
          ...current.filter((book) => book.bookId !== result.book.bookId),
        ]);
        setImportMessage(
          `文件夹《${result.book.title}》已导入为 Book，共 ${result.documents.length} 份 Markdown`,
        );
      })
      .catch((error: unknown) => {
        setImportMessage(error instanceof Error ? error.message : "文件夹导入失败");
      })
      .finally(() => setIsImporting(false));
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
                type="button"
                onClick={() => setDailyDialogOpen(true)}
              ><AppIcon icon={Sparkles} size={17} />创建每日阅读</Button>
              <Button
                disabled={documents.length === 0}
                type="button"
                variant="secondary"
                onClick={() => setCreateDialogOpen(true)}
              ><AppIcon icon={Plus} size={17} />创建 Book</Button>
              <Button
                disabled={isImporting}
                type="button"
                variant="secondary"
                onClick={() => setFolderDialogOpen(true)}
              ><AppIcon icon={FolderUp} size={17} />导入文件夹</Button>
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
                    onManageAutomation={() => void handleOpenAutomation(book.bookId)}
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
            <EmptyLibrary
              isDragging={isDragging}
              isImporting={isImporting}
              onFileChange={handleFileChange}
              onFolderImport={() => setFolderDialogOpen(true)}
            />
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
        <Dialog fullWidth maxWidth="sm" open={dailyDialogOpen} onClose={() => setDailyDialogOpen(false)}>
          <DialogTitle>创建每日阅读 Book</DialogTitle>
          <DialogContent className="library-book-dialog">
            <TextField
              fullWidth
              label="Book 标题"
              margin="dense"
              value={bookTitle}
              onChange={(event) => setBookTitle(event.target.value)}
            />
            <TextField
              fullWidth
              multiline
              minRows={4}
              label="你的英语水平、兴趣和阅读目标"
              margin="dense"
              placeholder="例如：我是一名雅思英语学习者，希望快速了解 AI、具身智能和机器人领域的前沿知识。"
              value={dailyInterest}
              onChange={(event) => setDailyInterest(event.target.value)}
            />
            <TextField
              fullWidth
              type="time"
              label="每日更新时间"
              margin="dense"
              slotProps={{ inputLabel: { shrink: true } }}
              value={dailyTime}
              onChange={(event) => setDailyTime(event.target.value)}
            />
            <p>创建后会立即尝试添加首篇，之后由本机 Local Service 每天更新一页；没有合格材料时不会降低来源和质量要求。</p>
          </DialogContent>
          <DialogActions>
            <Button type="button" variant="ghost" onClick={() => setDailyDialogOpen(false)}>取消</Button>
            <Button
              disabled={bookTitle.trim().length === 0 || dailyInterest.trim().length < 10 || isSavingBook}
              type="button"
              onClick={() => void handleCreateDailyBook()}
            >{isSavingBook ? "正在创建…" : "创建并寻找首篇"}</Button>
          </DialogActions>
        </Dialog>
        <ManageBookDialog
          book={manageBook}
          isSaving={isSavingBook}
          pageIds={managedPageIds}
          onClose={() => setManageBook(null)}
          onPageIdsChange={setManagedPageIds}
          onSave={() => void handleSavePageOrder()}
        />
        <Dialog fullWidth maxWidth="sm" open={manageAutomation !== null} onClose={() => setManageAutomation(null)}>
          <DialogTitle>每日阅读设置</DialogTitle>
          <DialogContent className="library-book-dialog">
            <FormControlLabel
              control={(
                <Switch
                  checked={manageAutomation?.enabled ?? false}
                  onChange={(_, checked) => setManageAutomation((current) => (
                    current === null ? null : { ...current, enabled: checked }
                  ))}
                />
              )}
              label={manageAutomation?.enabled ? "每日自动更新已启用" : "每日自动更新已暂停"}
            />
            <TextField
              fullWidth
              multiline
              minRows={4}
              label="英语水平、兴趣和阅读目标"
              margin="dense"
              value={manageAutomation?.interestDescription ?? ""}
              onChange={(event) => setManageAutomation((current) => (
                current === null ? null : { ...current, interestDescription: event.target.value }
              ))}
            />
            <TextField
              fullWidth
              type="time"
              label="每日更新时间"
              margin="dense"
              slotProps={{ inputLabel: { shrink: true } }}
              value={manageAutomation?.localTime ?? "08:00"}
              onChange={(event) => setManageAutomation((current) => (
                current === null ? null : { ...current, localTime: event.target.value }
              ))}
            />
            {manageAutomation?.interestProfile !== null && manageAutomation !== null && (
              <StatusNotice tone="neutral">
                <strong>系统理解：</strong>
                {manageAutomation.interestProfile.topics.join("、") || manageAutomation.interestProfile.readingGoal}
              </StatusNotice>
            )}
            {manageAutomation?.latestRun !== null && manageAutomation !== null && (
              <p>最近运行：{formatRunStatus(manageAutomation.latestRun.status)}</p>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              disabled={isSavingBook || manageAutomation?.latestRun?.status === "running"}
              type="button"
              variant="secondary"
              onClick={() => void handleRetryAutomation()}
            >立即重试</Button>
            <Button type="button" variant="ghost" onClick={() => setManageAutomation(null)}>关闭</Button>
            <Button
              disabled={(manageAutomation?.interestDescription.trim().length ?? 0) < 10 || isSavingBook}
              type="button"
              onClick={() => void handleSaveAutomation()}
            >{isSavingBook ? "正在保存…" : "保存设置"}</Button>
          </DialogActions>
        </Dialog>
        <Dialog fullWidth maxWidth="sm" open={folderDialogOpen} onClose={() => setFolderDialogOpen(false)}>
          <DialogTitle>导入 Markdown 文件夹</DialogTitle>
          <DialogContent className="library-folder-import-dialog">
            <p>文件夹中的每份 Markdown 会成为独立文档，并按完整相对路径自然排序组成一本同名 Book。</p>
            <div className="library-folder-guide">
              <strong>推荐目录结构</strong>
              <pre>{`My Book/
├── 00-preface.md
├── part-1/
│   ├── 01-chapter.md
│   └── images/scene.webp
└── shared/cover.png`}</pre>
            </div>
            <ul>
              <li>Markdown 请使用 UTF-8 编码，章节文件名前加连续序号可确保顺序清晰。</li>
              <li>图片建议使用 PNG、JPEG、GIF、WebP、AVIF 或 SVG，并放在所选文件夹内；SVG 会先经过安全净化。</li>
              <li>相对图片路径以当前 Markdown 所在目录为基准；路径不能越过所选文件夹。</li>
              <li>文件数量请控制在 2000 个以内，单个文件不超过 10 MiB，导入内容总计不超过 200 MiB。</li>
              <li>任一 Markdown 无法导入时，本次文件夹导入会整体回滚，不会生成残缺 Book。</li>
            </ul>
            <input
              ref={(node) => {
                folderInputRef.current = node;
                node?.setAttribute("webkitdirectory", "");
                node?.setAttribute("directory", "");
              }}
              className="library-hidden-file-input"
              type="file"
              multiple
              onChange={handleFolderChange}
            />
          </DialogContent>
          <DialogActions>
            <Button type="button" variant="ghost" onClick={() => setFolderDialogOpen(false)}>取消</Button>
            <Button disabled={isImporting} type="button" onClick={() => folderInputRef.current?.click()}>
              <AppIcon icon={FolderUp} size={16} />选择文件夹
            </Button>
          </DialogActions>
        </Dialog>
      </div>
    </AppShell>
  );
}

function BookCard({
  book,
  index,
  onManage,
  onManageAutomation,
}: {
  book: BookSummary;
  index: number;
  onManage: () => void;
  onManageAutomation: () => void;
}) {
  const theme = coverThemes[stableNumber(book.bookId) % coverThemes.length];
  const watermark = getWatermark(book.title);
  const cover = (
    <>
      <span className="library-document-format">BOOK</span>
      <span className="library-document-code">#{String(index + 1).padStart(3, "0")}–{watermark}B</span>
      <strong>{book.title}</strong>
      <span className="library-document-watermark" aria-hidden="true">{watermark}</span>
      {book.unreadAutoPageCount > 0 && <span className="library-book-new">NEW</span>}
    </>
  );
  return (
    <article className="library-document-card library-book-card">
      {book.pageCount > 0
        ? <Link className={`library-document-cover library-document-cover--${theme}`} to={`/reader/books/${book.bookId}`}>{cover}</Link>
        : <div className={`library-document-cover library-document-cover--${theme}`}>{cover}</div>}
      <div className="library-document-details">
        {book.pageCount > 0
          ? <Link to={`/reader/books/${book.bookId}`}><h2>{book.title}</h2></Link>
          : <h2>{book.title}</h2>}
        <p>{book.pageCount > 0 ? `${book.pageCount} 个 Markdown Page` : "正在等待首篇材料"}</p>
        <div className="library-document-meta">
          <span><AppIcon icon={BookOpen} size={14} />编排阅读</span>
          <span><AppIcon icon={Clock3} size={14} />{formatDate(book.updatedAt)}</span>
        </div>
        <div className="library-document-footer">
          <span>{book.hasDailyReadingAutomation ? "每日更新" : "Book"}</span>
          {book.hasDailyReadingAutomation && (
            <Button type="button" variant="ghost" onClick={onManageAutomation}>自动化设置</Button>
          )}
          <Button disabled={book.pageCount === 0} type="button" variant="ghost" onClick={onManage}>调整 Page 顺序</Button>
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
    <ButtonBase
      className={`library-import-button${isImporting ? " is-loading" : ""}`}
      component="label"
      disabled={isImporting}
    >
      <AppIcon className={isImporting ? "is-spinning" : undefined} icon={isImporting ? LoaderCircle : Upload} size={17} />
      <span>{isImporting ? "正在导入" : "导入文档"}</span>
      <input type="file" accept=".md,text/markdown" disabled={isImporting} onChange={onFileChange} />
    </ButtonBase>
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
  onFolderImport,
}: {
  isDragging: boolean;
  isImporting: boolean;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onFolderImport: () => void;
}) {
  return (
    <section className={`library-empty-state${isDragging ? " is-dragging" : ""}`} aria-labelledby="empty-library-title">
      <span className="library-empty-icon"><AppIcon icon={FileText} size={34} /></span>
      <p className="library-kicker">Your Local Archive</p>
      <h2 id="empty-library-title">从一篇真实材料开始</h2>
      <p>导入 Markdown 文档，Lumen 会在本地保留原文、阅读位置和学习语境。</p>
      <ImportControl isImporting={isImporting} onFileChange={onFileChange} />
      <Button disabled={isImporting} type="button" variant="secondary" onClick={onFolderImport}>
        <AppIcon icon={FolderUp} size={16} />导入文件夹并创建 Book
      </Button>
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

function formatRunStatus(
  status: NonNullable<DailyReadingAutomation["latestRun"]>["status"],
): string {
  return {
    requested: "等待执行",
    running: "正在寻找材料",
    completed: "已新增一篇",
    no_content: "今日没有合格内容",
    failed: "执行失败",
    interrupted: "上次执行被中断",
  }[status];
}
