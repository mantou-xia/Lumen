import { join, resolve } from "node:path";

import { config as loadDotEnv } from "dotenv";

import { buildApp } from "./app.js";
import { LibraryApplication } from "./application/library.js";
import { ReaderApplication } from "./application/reader.js";
import { TranslationApplication } from "./application/translation.js";
import { LearningApplication } from "./application/learning.js";
import { RecallApplication } from "./application/recall.js";
import { ControlledTaskRuntime } from "./agent-runtime/controlled-task-runtime.js";
import { OpenAiCompatibleProvider } from "./agent-runtime/openai-compatible-provider.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./infrastructure/database/database.js";
import { ManagedFileStore } from "./infrastructure/files/managed-file-store.js";
import { RuntimeRepository } from "./infrastructure/runtime/runtime-repository.js";

loadDotEnv({ path: resolve(import.meta.dirname, "../../..", ".env"), quiet: true });

const config = loadConfig();
const database = openDatabase(join(config.dataDirectory, "lumen.db"));
const fileStore = new ManagedFileStore(config.dataDirectory);
await fileStore.initialize();
const library = new LibraryApplication(database, fileStore);
await library.recoverInterruptedImports();
const reader = new ReaderApplication(database);
const runtimeRepository = new RuntimeRepository(database.connection);
runtimeRepository.interruptRunningOperations(new Date().toISOString());
const provider = new OpenAiCompatibleProvider(config.modelProvider);
const runtime = new ControlledTaskRuntime(provider, runtimeRepository);
const translation = new TranslationApplication(database, runtime);
const learning = new LearningApplication(database);
const recall = new RecallApplication(database, runtime);
const app = buildApp({ database, library, reader, translation, learning, recall, logger: true });

const shutdown = async (): Promise<void> => {
  await app.close();
  database.close();
};

process.once("SIGINT", () => {
  void shutdown();
});

process.once("SIGTERM", () => {
  void shutdown();
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await shutdown();
  process.exitCode = 1;
}
