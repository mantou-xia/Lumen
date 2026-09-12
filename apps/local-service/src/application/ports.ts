import type { Readable } from "node:stream";

import type {
  Annotation,
  AnnotationRangeQuery,
  AnnotationSource,
  BookDetail,
  BookReadingProgress,
  BookSummary,
  DocumentDetail,
  DocumentCapabilities,
  DocumentFormatDescriptor,
  DocumentSummary,
  DailyReadingInterestProfile,
  ExpressionType,
  ImportOperation,
  ImportOperationKind,
  ImportOperationStatus,
  ImportDocumentResponse,
  ImportMarkdownFolderResponse,
  LearningContext,
  LearningContextSort,
  LearningExpressionDetail,
  LearningExpressionSummary,
  LearningItem,
  LearningListQuery,
  LexicalLocalization,
  LexicalProfile,
  Operation,
  OutlineEntry,
  ReadingProgress,
  RecallEvaluation,
  RecallMatch,
  RecallMatchesRequest,
  RecallOccurrence,
  SemanticBlock,
  SourceMapping,
  SemanticSelection,
  ProviderStatus,
  TranslateSelectionRequest,
  TranslationRangeQuery,
  TranslationRangeSummary,
  TranslationResult,
  UpdateReadingProgressRequest,
  WorkspaceReference,
  WorkspaceReferenceInput,
  WorkspaceSession,
  WorkspaceSessionSummary,
  WorkspaceTurn,
} from "@lumen/api-contract";

import type { ModelProvider } from "../agent-runtime/model-provider.js";
import type {
  FormatAdapterRegistryPort,
  ImportArtifact,
} from "../content/format/format-contract.js";

export interface ClockPort { now(): string; }
export interface IdGeneratorPort { generate(): string; }
export interface TransactionPort { run<T>(work: () => T): T; }

export interface StoredFileInfo {
  byteSize: number;
  contentHash: string;
}

export interface FileStorePort {
  stagingKey(operationId: string): string;
  sourceStorageKey(documentId: string, resourceId: string, extension: string): string;
  imageStorageKey(documentId: string, revisionId: string, resourceId: string, extension: string): string;
  writeStagingFile(storageKey: string, source: Readable): Promise<StoredFileInfo>;
  writeManagedFile(storageKey: string, content: Uint8Array): Promise<StoredFileInfo>;
  readSource(storageKey: string): Promise<Uint8Array>;
  createReadStream(storageKey: string, range?: { start: number; end: number }): Readable;
  promote(stagingKey: string, storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
  remove(storageKey: string | null): Promise<void>;
  cleanupStaging(): Promise<void>;
}

export interface ResourceRecord {
  resourceId: string;
  mediaType: string;
  originalFilename: string;
  storageKey: string;
  byteSize: number;
  state: "committed" | "missing";
}

export interface ResourceRepositoryPort {
  getResource(resourceId: string): ResourceRecord | null;
}

export interface SourceMappingRepositoryPort {
  findBySemanticPoint(revisionId: string, blockId: string, offset: number): SourceMapping[];
  findBySourceOffset(revisionId: string, sourceOffset: number): SourceMapping[];
}

export interface DraftRevisionInput {
  documentId: string;
  revisionId: string;
  resourceId: string;
  operationId: string;
  originalFilename: string;
  storageKey: string;
  contentHash: string;
  byteSize: number;
  sourceMediaType: string;
  artifact: ImportArtifact;
  managedImages: ManagedImageDraft[];
  now: string;
}

export interface ManagedImageDraft {
  resourceId: string;
  sourceUrl: string;
  altText: string;
  originalFilename: string;
  mediaType: string;
  storageKey: string;
  contentHash: string | null;
  byteSize: number;
  state: "staging" | "missing";
}

export interface DraftDocumentInput extends DraftRevisionInput {
  title: string;
}

export interface RecoverableImport {
  operationId: string;
  kind: ImportOperationKind;
  status: ImportOperationStatus;
  stagingKey: string | null;
  documentId: string | null;
  revisionId: string | null;
  resourceId: string | null;
  storageKey: string | null;
}

export interface LibraryRepositoryPort {
  createImportOperation(input: {
    operationId: string;
    kind: ImportOperationKind;
    originalFilename: string;
    stagingKey: string;
    documentId: string | null;
    now: string;
  }): void;
  updateImportStatus(operationId: string, status: ImportOperationStatus, now: string): void;
  registerDraftDocument(input: DraftDocumentInput): void;
  registerDraftRevision(input: DraftRevisionInput): void;
  completeImport(input: { operationId: string; documentId: string; revisionId: string; resourceId: string; now: string }): void;
  failImport(input: { operationId: string; errorCode: string; errorMessage: string; status?: "failed" | "interrupted"; now: string }): void;
  deleteDraftDocument(documentId: string): void;
  deleteDraftRevision(revisionId: string): void;
  listDocuments(): DocumentSummary[];
  getDocument(documentId: string): DocumentDetail | null;
  getImportOperation(operationId: string): ImportOperation | null;
  listRecoverableImports(): RecoverableImport[];
  listDocumentStorageKeys(documentIds: readonly string[]): string[];
}

export interface LibraryApplicationDependencies {
  adapters: FormatAdapterRegistryPort;
  clock: ClockPort;
  fileStore: FileStorePort;
  ids: IdGeneratorPort;
  repository: LibraryRepositoryPort;
  transaction: TransactionPort;
}

export interface FolderImportFile {
  relativePath: string;
  content: Uint8Array;
}

export interface FolderImportApplicationDependencies {
  books: {
    createBook(input: { title: string; documentIds: string[] }): BookDetail;
  };
  fileStore: Pick<FileStorePort, "remove">;
  library: {
    importDocument(
      originalFilename: string,
      source: Readable,
      mediaType: string | null,
      container: { sourcePath: string; files: ReadonlyMap<string, Uint8Array> },
    ): Promise<ImportDocumentResponse>;
  };
  repository: Pick<LibraryRepositoryPort, "deleteDraftDocument" | "listDocumentStorageKeys">;
  transaction: TransactionPort;
}

export interface FolderImportApplicationPort {
  importFolder(folderName: string, files: FolderImportFile[]): Promise<ImportMarkdownFolderResponse>;
}

export interface MarkdownImageRecord {
  resourceId: string;
  documentId: string;
  revisionId: string;
  altText: string;
  state: "committed" | "missing";
}

export interface MarkdownImageRepositoryPort {
  getImage(documentId: string, revisionId: string, resourceId: string): MarkdownImageRecord | null;
  replaceMissingImage(input: {
    documentId: string | null;
    revisionId: string | null;
    resourceId: string;
    originalFilename: string;
    mediaType: string;
    storageKey: string;
    contentHash: string;
    byteSize: number;
    replacementHtml: string;
  }): string | null;
}

export interface MarkdownImageApplicationDependencies {
  fileStore: FileStorePort;
  ids: IdGeneratorPort;
  repository: MarkdownImageRepositoryPort;
  transaction: TransactionPort;
}

export interface BookPageRecord {
  pageId: string;
  bookId: string;
  documentId: string;
  order: number;
  origin: "manual" | "folder_import" | "scheduled_reading";
  viewedAt: string | null;
}

export interface BookRepositoryPort {
  listBooks(): BookSummary[];
  getBook(bookId: string): BookDetail | null;
  getPage(bookId: string, pageId: string): BookPageRecord | null;
  createBook(input: {
    bookId: string;
    title: string;
    formatId: string;
    pages: Array<{
      pageId: string;
      documentId: string;
      order: number;
      origin?: "manual" | "folder_import" | "scheduled_reading";
      viewedAt?: string | null;
      dailyReadingRunId?: string | null;
    }>;
    now: string;
  }): BookDetail;
  appendPage(input: {
    pageId: string;
    bookId: string;
    documentId: string;
    origin: "manual" | "folder_import" | "scheduled_reading";
    viewedAt: string | null;
    dailyReadingRunId: string | null;
    now: string;
  }): BookDetail;
  markPageViewed(bookId: string, pageId: string, viewedAt: string): void;
  reorderPages(bookId: string, pageIds: readonly string[], now: string): BookDetail;
  getActivePageId(bookId: string): string | null;
  getPageProgress(bookId: string, pageId: string, activeRevisionId: string): ReadingProgress | null;
  isValidPosition(
    bookId: string,
    pageId: string,
    input: UpdateReadingProgressRequest,
  ): boolean;
  calculateProgress(bookId: string, pageId: string, pageProgression: number): number;
  saveProgress(
    bookId: string,
    pageId: string,
    input: UpdateReadingProgressRequest,
    savedAt: string,
  ): BookReadingProgress;
}

export interface BookApplicationDependencies {
  clock: ClockPort;
  documents: Pick<LibraryRepositoryPort, "getDocument">;
  ids: IdGeneratorPort;
  reader: { openDocument(documentId: string): Promise<import("@lumen/api-contract").ReaderDocument> };
  repository: BookRepositoryPort;
  transaction: TransactionPort;
}

export interface ReaderProjection {
  revisionId: string;
  format: DocumentFormatDescriptor;
  capabilities: DocumentCapabilities;
  renderHtml: string;
}

export interface ReaderRevisionSource {
  storageKey: string;
  originalFilename: string;
  mediaType: string;
}

export interface ReaderRepositoryPort {
  revisionBelongsToDocument(documentId: string, revisionId: string): boolean;
  getProjection(revisionId: string): ReaderProjection | null;
  getRevisionSource(revisionId: string): ReaderRevisionSource | null;
  listBlocks(revisionId: string): SemanticBlock[];
  listOutline(revisionId: string): OutlineEntry[];
  replaceRenderProjection(input: {
    revisionId: string;
    adapterVersion: string;
    renderProjectionVersion: string;
    renderHtml: string;
    now: string;
  }): void;
  getProgress(documentId: string): ReadingProgress | null;
  isValidPosition(documentId: string, input: UpdateReadingProgressRequest): boolean;
  saveProgress(documentId: string, input: UpdateReadingProgressRequest, savedAt: string): ReadingProgress;
}

export interface ReaderApplicationDependencies {
  adapters: FormatAdapterRegistryPort;
  clock: ClockPort;
  documents: Pick<LibraryRepositoryPort, "getDocument">;
  fileStore: Pick<FileStorePort, "readSource">;
  reader: ReaderRepositoryPort;
  transaction: TransactionPort;
}

export interface SelectionNormalizerPort {
  normalize(documentId: string, input: TranslateSelectionRequest, selectionId: string): {
    selection: SemanticSelection;
    directContext: string;
    surroundingContext: string;
  };
}

export interface AnnotationRepositoryPort {
  sourceExists(documentId: string, revisionId: string, source: AnnotationSource): boolean;
  create(input: {
    annotationId: string;
    selection: SemanticSelection;
    note: string;
    source: AnnotationSource;
    now: string;
  }): Annotation;
  listRanges(documentId: string, input: AnnotationRangeQuery): Annotation[];
  get(annotationId: string): Annotation | null;
  updateNote(annotationId: string, note: string, now: string): Annotation | null;
  archive(annotationId: string, now: string): Annotation | null;
}

export interface AnnotationApplicationDependencies {
  clock: ClockPort;
  ids: IdGeneratorPort;
  repository: AnnotationRepositoryPort;
  selection: SelectionNormalizerPort;
  transaction: TransactionPort;
}

export interface TranslationRepositoryPort {
  save(result: TranslationResult): void;
  getById(translationId: string): TranslationResult | null;
  findByFingerprint(revisionId: string, fingerprint: string): TranslationResult | null;
  listRanges(documentId: string, input: TranslationRangeQuery): TranslationRangeSummary[];
}

export interface RuntimeRepositoryPort {
  createOperation(input: {
    operationId: string;
    taskType: string;
    taskVersion: string;
    documentId: string | null;
    revisionId: string | null;
    contextSnapshot: string;
    previousOperationId?: string;
    cacheKey?: string;
    now: string;
  }): void;
  markOperationRunning(operationId: string, now: string): void;
  completeOperation(operationId: string, now: string): void;
  failOperation(operationId: string, code: string, message: string, now: string): void;
  cancelOperation(operationId: string, now: string): void;
  recordTaskCompiled(input: {
    operationId: string;
    taskVersion: string;
    contextPolicy: string;
    contextSnapshot: string;
    compiledAt: string;
  }): void;
  recordCacheHit(input: {
    sourceOperationId: string;
    taskType: string;
    taskVersion: string;
    cacheKey: string;
    hitAt: string;
  }): void;
  startInvocation(input: {
    invocationId: string;
    operationId: string;
    providerId: string;
    modelId: string;
    startedAt: string;
  }): void;
  completeInvocation(input: {
    invocationId: string;
    inputTokens: number | null;
    outputTokens: number | null;
    finishReason: string | null;
    latencyMs: number;
    completedAt: string;
  }): void;
  failInvocation(input: {
    invocationId: string;
    errorCode: string;
    errorMessage: string;
    latencyMs: number;
    completedAt: string;
  }): void;
  cancelInvocation(input: { invocationId: string; latencyMs: number; completedAt: string }): void;
  interruptRunningOperations(now: string): void;
  getOperation(operationId: string): Operation | null;
  listOperationEvents(
    operationId: string,
    afterSequence: number,
    limit: number,
  ): import("@lumen/api-contract").OperationEvent[];
}

export interface TranslationTaskOutput {
  contextualTranslation: string;
  contextualMeaning: string;
  expressionType: ExpressionType;
  explanation: string;
  uncertainty: string;
}

export interface RecallTaskOutput {
  verdict: "understood" | "partially_understood" | "misunderstood";
  feedback: string;
  contextualMeaning: string;
  missingPoints: string[];
}

export interface LexicalLocalizationTaskOutput {
  senses: Array<{
    sourceGloss: string;
    chineseGloss: string;
    usageNote: string;
  }>;
  etymologySummary: string;
}

export interface WorkspaceTaskOutput {
  content: string;
  citationReferenceIds: string[];
  outcome: "answered" | "insufficient_evidence";
}

export interface WorkspaceRepositoryPort {
  openLatestOrCreateSession(input: {
    sessionId: string;
    documentId: string;
    revisionId: string;
    now: string;
  }): WorkspaceSession | null;
  createSession(input: {
    sessionId: string;
    documentId: string;
    revisionId: string;
    now: string;
  }): WorkspaceSession | null;
  listSessions(documentId: string, revisionId: string): WorkspaceSessionSummary[];
  getSession(sessionId: string): WorkspaceSession | null;
  resolveReference(
    sessionId: string,
    input: WorkspaceReferenceInput,
    referenceId: string,
  ): WorkspaceReference | null;
  listSemanticBlocks(revisionId: string): Array<{
    blockId: string;
    blockType: string;
    blockOrder: number;
    text: string;
  }>;
  searchSemanticBlocks(revisionId: string, query: string, limit: number): Array<{
    blockId: string;
    blockType: string;
    blockOrder: number;
    text: string;
  }>;
  saveTurn(input: {
    sessionId: string;
    turn: WorkspaceTurn;
  }): void;
}

export interface ControlledTaskRuntimePort {
  provider: ModelProvider;
  cancel(operationId: string): boolean;
  executeTranslation(input: {
    operationId: string;
    selectedText: string;
    surroundingContext: string;
    signal?: AbortSignal;
  }): Promise<TranslationTaskOutput>;
  executeRecall(input: {
    operationId: string;
    expression: string;
    currentContext: string;
    historicalMeaning: string;
    userInterpretation: string;
    signal?: AbortSignal;
  }): Promise<RecallTaskOutput>;
  executeLexicalLocalization(input: {
    operationId: string;
    profile: LexicalProfile;
    signal?: AbortSignal;
  }): Promise<LexicalLocalizationTaskOutput>;
  executeWorkspace(input: {
    operationId: string;
    question: string;
    contextMode: "full_document" | "retrieved_document" | "explicit_references_only";
    references: WorkspaceReference[];
    signal?: AbortSignal;
  }): Promise<WorkspaceTaskOutput>;
  executeWorkspaceQueryRewrite(input: {
    operationId: string;
    question: string;
    signal?: AbortSignal;
  }): Promise<{ query: string }>;
  executeDailyReadingInterest(input: {
    operationId: string;
    interestDescription: string;
    signal?: AbortSignal;
  }): Promise<DailyReadingInterestProfile>;
  executeDailyReadingSelection(input: {
    operationId: string;
    interestDescription: string;
    candidates: Array<{
      candidateId: string;
      publisher: string;
      title: string;
      summary: string;
      publishedAt: string | null;
    }>;
    signal?: AbortSignal;
  }): Promise<{ rankedCandidateIds: string[] }>;
}

export interface WorkspaceApplicationDependencies {
  clock: ClockPort;
  ids: IdGeneratorPort;
  operations: RuntimeRepositoryPort;
  repository: WorkspaceRepositoryPort;
  runtime: ControlledTaskRuntimePort;
  selection: SelectionNormalizerPort;
  transaction: TransactionPort;
}

export interface LexicalSourceRecord {
  entryId: string;
  lemma: string;
  revisionId: string;
  revisionTimestamp: string;
  sourceUrl: string;
  wikitext: string;
}

export interface LexicalSourcePort {
  fetchEntry(lemma: string, signal?: AbortSignal): Promise<LexicalSourceRecord | null>;
}

export interface CachedLexicalEntry {
  normalizedLemma: string;
  rawWikitext: string;
  profile: LexicalProfile;
  localization: LexicalLocalization | null;
}

export interface LexicalRepositoryPort {
  findByNormalizedLemma(normalizedLemma: string): CachedLexicalEntry | null;
  saveProfile(input: {
    normalizedLemma: string;
    rawWikitext: string;
    profile: LexicalProfile;
    now: string;
  }): void;
  saveLocalization(localization: LexicalLocalization, now: string): void;
}

export interface LexicalApplicationDependencies {
  clock: ClockPort;
  ids: IdGeneratorPort;
  operations: RuntimeRepositoryPort;
  repository: LexicalRepositoryPort;
  runtime: ControlledTaskRuntimePort;
  source: LexicalSourcePort;
  transaction: TransactionPort;
  translations: Pick<TranslationRepositoryPort, "getById">;
}

export interface TranslationApplicationDependencies {
  clock: ClockPort;
  ids: IdGeneratorPort;
  operations: RuntimeRepositoryPort;
  runtime: ControlledTaskRuntimePort;
  selection: SelectionNormalizerPort;
  transaction: TransactionPort;
  translations: TranslationRepositoryPort;
}

export function providerStatus(provider: ModelProvider): ProviderStatus {
  return {
    configured: provider.configured,
    provider: provider.providerId,
    model: provider.modelId === "unconfigured" ? null : provider.modelId,
    baseUrl: provider.baseUrl,
  };
}

export interface LearningTranslationRecord {
  translationId: string;
  operationId: string;
  documentId: string;
  revisionId: string;
  startBlockId: string;
  startOffset: number;
  endBlockId: string;
  endOffset: number;
  selectedText: string;
  selectionFingerprint: string;
  surroundingContext: string;
  contextualTranslation: string;
  contextualMeaning: string;
  expressionType: ExpressionType;
  explanation: string;
  uncertainty: string;
}

export interface ExpressionRecord {
  expressionId: string;
  canonicalForm: string;
  normalizedForm: string;
  expressionType: ExpressionType;
  status: "active" | "familiar" | "archived";
  userNote: string;
  createdAt: string;
  updatedAt: string;
}

export interface LearningQueryResult {
  items: LearningExpressionSummary[];
  totalExpressions: number;
  totalContexts: number;
  hasMore: boolean;
}

export interface LearningRepositoryPort {
  getCompletedTranslation(translationId: string): LearningTranslationRecord | null;
  findUnambiguousExpression(normalizedForm: string): ExpressionRecord | null;
  createExpression(input: {
    expressionId: string;
    canonicalForm: string;
    normalizedForm: string;
    expressionType: ExpressionType;
    now: string;
  }): ExpressionRecord;
  ensureObservedVariant(input: {
    variantId: string;
    expressionId: string;
    surfacePattern: string;
    normalizedPattern: string;
    now: string;
  }): void;
  findContext(expressionId: string, revisionId: string, fingerprint: string): LearningContext | null;
  restoreContext(expressionId: string, revisionId: string, fingerprint: string, now: string): void;
  createContext(input: {
    learningContextId: string;
    expressionId: string;
    translation: LearningTranslationRecord;
    now: string;
  }): LearningContext;
  listItems(): LearningItem[];
  getItem(expressionId: string): LearningItem | null;
  queryItems(input: LearningListQuery & { offset: number }): LearningQueryResult;
  getDetails(expressionId: string, contextSort: LearningContextSort): LearningExpressionDetail | null;
  updateExpressionStatus(input: {
    historyId: string;
    expressionId: string;
    status: ExpressionRecord["status"];
    now: string;
  }): boolean;
  updateExpressionNote(expressionId: string, note: string, now: string): boolean;
  updateContextNote(expressionId: string, contextId: string, note: string, now: string): boolean;
  archiveContext(expressionId: string, contextId: string, now: string): boolean;
}

export interface LearningApplicationDependencies {
  clock: ClockPort;
  ids: IdGeneratorPort;
  repository: LearningRepositoryPort;
  transaction: TransactionPort;
}

export interface RecallOccurrenceRecord extends RecallOccurrence {
  canonicalForm: string;
  historicalMeaning: string;
}

export interface RecallRepositoryPort {
  findMatches(revisionId: string, blockIds: string[]): RecallMatch[];
  validateMatch(revisionId: string, match: RecallMatch): {
    documentId: string;
    currentContext: string;
  } | null;
  findOrCreateOccurrence(input: {
    occurrenceId: string;
    documentId: string;
    revisionId: string;
    match: RecallMatch;
    currentContext: string;
    now: string;
  }): RecallOccurrence;
  getOccurrence(occurrenceId: string): RecallOccurrenceRecord | null;
  saveAttempt(result: RecallEvaluation): void;
}

export interface RecallApplicationDependencies {
  clock: ClockPort;
  documents: Pick<LibraryRepositoryPort, "getDocument">;
  ids: IdGeneratorPort;
  operations: RuntimeRepositoryPort;
  repository: RecallRepositoryPort;
  runtime: ControlledTaskRuntimePort;
  transaction: TransactionPort;
}

export interface RecallApplicationPort {
  findMatches(documentId: string, input: RecallMatchesRequest): RecallMatch[];
}
