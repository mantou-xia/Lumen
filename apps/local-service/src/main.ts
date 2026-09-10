import { join, resolve } from "node:path";

import { config as loadDotEnv } from "dotenv";

import { buildApp } from "./app.js";
import { ControlledTaskRuntime } from "./agent-runtime/controlled-task-runtime.js";
import { OpenAiCompatibleProvider } from "./agent-runtime/openai-compatible-provider.js";
import { loadConfig } from "./config.js";
import {
  createAnnotationApplication,
  createBookApplication,
  createLibraryApplication,
  createLearningApplication,
  createLexicalApplication,
  createNetworkSettingsApplication,
  createReaderApplication,
  createRecallApplication,
  createResourceApplication,
  createSourceMappingApplication,
  createRuntimeApplication,
  createTranslationApplication,
  createWorkspaceApplication,
  randomIdGenerator,
  systemClock,
} from "./composition-root.js";
import { openDatabase } from "./infrastructure/database/database.js";
import { ManagedFileStore } from "./infrastructure/files/managed-file-store.js";
import {
  createOutboundHttpClient,
} from "./infrastructure/http/outbound-http.js";
import { RuntimeRepository } from "./infrastructure/runtime/runtime-repository.js";
import { NetworkSettingsRepository } from "./infrastructure/settings/network-settings-repository.js";
import { WiktionarySource } from "./lexical/wiktionary-source.js";

loadDotEnv({ path: resolve(import.meta.dirname, "../../..", ".env"), quiet: true });

const config = loadConfig();
const database = openDatabase(join(config.dataDirectory, "lumen.db"));
const networkSettingsRepository = new NetworkSettingsRepository(database.connection);
const outboundHttp = createOutboundHttpClient(() => networkSettingsRepository.get());
const fileStore = new ManagedFileStore(config.dataDirectory);
await fileStore.initialize();
const library = createLibraryApplication(database, fileStore);
await library.recoverInterruptedImports();
const reader = createReaderApplication(database, fileStore);
const books = createBookApplication(database, reader);
const resources = createResourceApplication(database, fileStore);
const sourceMappings = createSourceMappingApplication(database);
const networkSettings = createNetworkSettingsApplication(database, outboundHttp);
const runtimeRepository = new RuntimeRepository(database.connection);
runtimeRepository.interruptRunningOperations(new Date().toISOString());
const provider = new OpenAiCompatibleProvider(config.modelProvider);
const runtime = new ControlledTaskRuntime(provider, runtimeRepository, randomIdGenerator, systemClock);
const translation = createTranslationApplication(database, runtime);
const annotations = createAnnotationApplication(database);
const learning = createLearningApplication(database);
const lexical = createLexicalApplication(
  database,
  runtime,
  new WiktionarySource(undefined, outboundHttp.fetch),
);
const recall = createRecallApplication(database, runtime);
const runtimeApplication = createRuntimeApplication(database, runtime);
const workspace = createWorkspaceApplication(database, runtime);
const app = buildApp({
  annotations,
  books,
  database,
  library,
  reader,
  translation,
  learning,
  lexical,
  networkSettings,
  recall,
  runtime: runtimeApplication,
  resources,
  sourceMappings,
  workspace,
  logger: true,
});

const shutdown = async (): Promise<void> => {
  await app.close();
  await outboundHttp.close();
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
