import { randomUUID } from "node:crypto";

import { AnnotationApplication } from "./application/annotation.js";
import { LibraryApplication } from "./application/library.js";
import { LearningApplication } from "./application/learning.js";
import { LexicalApplication } from "./application/lexical.js";
import { RecallApplication } from "./application/recall.js";
import { ReaderApplication } from "./application/reader.js";
import { ResourceApplication } from "./application/resource.js";
import { SourceMappingApplication } from "./application/source-mapping.js";
import { RuntimeApplication } from "./application/runtime.js";
import { TranslationApplication } from "./application/translation.js";
import { WorkspaceApplication } from "./application/workspace.js";
import type {
  ClockPort,
  IdGeneratorPort,
  LexicalSourcePort,
  TransactionPort,
} from "./application/ports.js";
import { LibraryRepository } from "./content/library-repository.js";
import { FormatAdapterRegistry } from "./content/format/format-adapter-registry.js";
import { MarkdownDocumentAdapter } from "./content/markdown/markdown-adapter.js";
import { ReaderRepository } from "./content/reader-repository.js";
import { ResourceRepository } from "./content/resource-repository.js";
import { SourceMappingRepository } from "./content/source-mapping-repository.js";
import { SelectionService } from "./content/selection-service.js";
import { TranslationRepository } from "./content/translation-repository.js";
import type { ControlledTaskRuntime } from "./agent-runtime/controlled-task-runtime.js";
import type { LumenDatabase } from "./infrastructure/database/database.js";
import type { ManagedFileStore } from "./infrastructure/files/managed-file-store.js";
import { RuntimeRepository } from "./infrastructure/runtime/runtime-repository.js";
import { AnnotationRepository } from "./learning/annotation-repository.js";
import { LearningRepository } from "./learning/learning-repository.js";
import { LexicalRepository } from "./learning/lexical-repository.js";
import { RecallRepository } from "./learning/recall-repository.js";
import { WorkspaceRepository } from "./workspace/workspace-repository.js";

export const systemClock: ClockPort = { now: () => new Date().toISOString() };
export const randomIdGenerator: IdGeneratorPort = { generate: () => randomUUID() };

export function databaseTransaction(database: LumenDatabase): TransactionPort {
  return { run: (work) => database.transaction(work) };
}

export function createLibraryApplication(database: LumenDatabase, fileStore: ManagedFileStore): LibraryApplication {
  return new LibraryApplication({
    adapters: new FormatAdapterRegistry([new MarkdownDocumentAdapter()]),
    clock: systemClock,
    fileStore,
    ids: randomIdGenerator,
    repository: new LibraryRepository(database.connection),
    transaction: databaseTransaction(database),
  });
}

export function createReaderApplication(
  database: LumenDatabase,
  fileStore: ManagedFileStore,
): ReaderApplication {
  return new ReaderApplication({
    adapters: new FormatAdapterRegistry([new MarkdownDocumentAdapter()]),
    clock: systemClock,
    documents: new LibraryRepository(database.connection),
    fileStore,
    reader: new ReaderRepository(database.connection),
    transaction: databaseTransaction(database),
  });
}

export function createResourceApplication(
  database: LumenDatabase,
  fileStore: ManagedFileStore,
): ResourceApplication {
  return new ResourceApplication(new ResourceRepository(database.connection), fileStore);
}

export function createSourceMappingApplication(database: LumenDatabase): SourceMappingApplication {
  return new SourceMappingApplication(new SourceMappingRepository(database.connection));
}

export function createTranslationApplication(
  database: LumenDatabase,
  runtime: ControlledTaskRuntime,
): TranslationApplication {
  return new TranslationApplication({
    clock: systemClock,
    ids: randomIdGenerator,
    operations: new RuntimeRepository(database.connection),
    runtime,
    selection: new SelectionService(database.connection),
    transaction: databaseTransaction(database),
    translations: new TranslationRepository(database.connection),
  });
}

export function createAnnotationApplication(database: LumenDatabase): AnnotationApplication {
  return new AnnotationApplication({
    clock: systemClock,
    ids: randomIdGenerator,
    repository: new AnnotationRepository(database.connection),
    selection: new SelectionService(database.connection),
    transaction: databaseTransaction(database),
  });
}

export function createLearningApplication(database: LumenDatabase): LearningApplication {
  return new LearningApplication({
    clock: systemClock,
    ids: randomIdGenerator,
    repository: new LearningRepository(database.connection),
    transaction: databaseTransaction(database),
  });
}

export function createLexicalApplication(
  database: LumenDatabase,
  runtime: ControlledTaskRuntime,
  source: LexicalSourcePort,
): LexicalApplication {
  return new LexicalApplication({
    clock: systemClock,
    ids: randomIdGenerator,
    operations: new RuntimeRepository(database.connection),
    repository: new LexicalRepository(database.connection),
    runtime,
    source,
    transaction: databaseTransaction(database),
    translations: new TranslationRepository(database.connection),
  });
}

export function createRecallApplication(
  database: LumenDatabase,
  runtime: ControlledTaskRuntime,
): RecallApplication {
  return new RecallApplication({
    clock: systemClock,
    documents: new LibraryRepository(database.connection),
    ids: randomIdGenerator,
    operations: new RuntimeRepository(database.connection),
    repository: new RecallRepository(database.connection),
    runtime,
    transaction: databaseTransaction(database),
  });
}

export function createRuntimeApplication(
  database: LumenDatabase,
  runtime: ControlledTaskRuntime,
): RuntimeApplication {
  return new RuntimeApplication(new RuntimeRepository(database.connection), runtime);
}

export function createWorkspaceApplication(
  database: LumenDatabase,
  runtime: ControlledTaskRuntime,
): WorkspaceApplication {
  return new WorkspaceApplication({
    clock: systemClock,
    ids: randomIdGenerator,
    operations: new RuntimeRepository(database.connection),
    repository: new WorkspaceRepository(database.connection),
    runtime,
    selection: new SelectionService(database.connection),
    transaction: databaseTransaction(database),
  });
}
