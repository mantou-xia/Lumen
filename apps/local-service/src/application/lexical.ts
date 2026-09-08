import type {
  CachedLexicalEntry,
  LexicalApplicationDependencies,
} from "./ports.js";
import type {
  LexicalAttribution,
  LexicalLocalization,
  LexicalProfileResponse,
  TranslationResult,
} from "@lumen/api-contract";

import { ApplicationError } from "./errors.js";
import {
  buildLexicalLookupCandidates,
  normalizeLexicalLookup,
} from "../lexical/lookup-candidates.js";
import { parseWiktionaryEntry } from "../lexical/wiktionary-parser.js";

const attribution: LexicalAttribution = {
  sourceName: "English Wiktionary",
  sourceUrl: "https://en.wiktionary.org/",
  licenseName: "CC BY-SA 4.0 / GFDL",
  licenseUrl: "https://en.wiktionary.org/wiki/Wiktionary:Copyrights",
  attributionText: "Source: English Wiktionary contributors; licensed under CC BY-SA 4.0 and GFDL.",
};

export class LexicalApplication {
  constructor(private readonly dependencies: LexicalApplicationDependencies) {}

  async getProfile(
    translationId: string,
    refresh = false,
    signal?: AbortSignal,
  ): Promise<LexicalProfileResponse> {
    const translation = this.dependencies.translations.getById(translationId);
    if (translation === null) {
      throw new ApplicationError({
        code: "TRANSLATION_NOT_FOUND",
        message: "翻译结果不存在",
        statusCode: 404,
      });
    }

    const candidates = buildLexicalLookupCandidates(translation.selection.selectedText);
    const cached = this.findCached(candidates);
    let entry = refresh ? null : cached;
    let sourceUnavailable = false;

    if (entry === null) {
      try {
        entry = await this.fetchAndPersist(candidates, signal);
      } catch (error) {
        if (error instanceof ApplicationError && error.code === "LEXICAL_SOURCE_UNAVAILABLE") {
          sourceUnavailable = true;
          entry = cached;
        } else {
          throw error;
        }
      }
    }

    if (entry === null) {
      return {
        lookupText: translation.selection.selectedText,
        matchedLemma: null,
        status: sourceUnavailable ? "source_unavailable" : "not_found",
        profile: null,
        localizationStatus: "not_applicable",
        localization: null,
        message: sourceUnavailable
          ? "当前无法连接网络，且本地没有可用的词汇资料缓存。"
          : "English Wiktionary 中未找到可用的英文词条。",
        attribution,
      };
    }

    const localization = entry.localization ?? await this.localize(translation, entry, signal);
    return {
      lookupText: translation.selection.selectedText,
      matchedLemma: entry.profile.lemma,
      status: "ready",
      profile: entry.profile,
      localizationStatus: localization === null ? "unavailable" : "ready",
      localization,
      message: sourceUnavailable
        ? "当前无法连接网络，正在使用本地缓存的词汇资料。"
        : localization === null
          ? "英文词汇资料可用，但中文本地化暂不可用。"
          : null,
      attribution: { ...attribution, sourceUrl: entry.profile.sourceUrl },
    };
  }

  private findCached(candidates: string[]): CachedLexicalEntry | null {
    for (const candidate of candidates) {
      const cached = this.dependencies.repository.findByNormalizedLemma(candidate);
      if (cached !== null) return cached;
    }
    return null;
  }

  private async fetchAndPersist(
    candidates: string[],
    signal?: AbortSignal,
  ): Promise<CachedLexicalEntry | null> {
    for (const candidate of candidates) {
      const source = await this.dependencies.source.fetchEntry(candidate, signal);
      if (source === null) continue;
      const now = this.dependencies.clock.now();
      const profile = parseWiktionaryEntry(source, now);
      if (profile === null) continue;
      const normalizedLemma = normalizeLexicalLookup(candidate);
      this.dependencies.transaction.run(() => {
        this.dependencies.repository.saveProfile({
          normalizedLemma,
          rawWikitext: source.wikitext,
          profile,
          now,
        });
      });
      return this.dependencies.repository.findByNormalizedLemma(normalizedLemma);
    }
    return null;
  }

  private async localize(
    translation: TranslationResult,
    entry: CachedLexicalEntry,
    signal?: AbortSignal,
  ): Promise<LexicalLocalization | null> {
    if (!this.dependencies.runtime.provider.configured) return null;
    const operationId = this.dependencies.ids.generate();
    const now = this.dependencies.clock.now();
    this.dependencies.transaction.run(() => {
      this.dependencies.operations.createOperation({
        operationId,
        taskType: "lexical.localization",
        taskVersion: "lexical.localization.v1",
        documentId: translation.selection.documentId,
        revisionId: translation.selection.revisionId,
        contextSnapshot: JSON.stringify({
          schemaVersion: 1,
          type: "lexical.localization.context",
          payload: {
            entryId: entry.profile.entryId,
            lemma: entry.profile.lemma,
            sourceRevisionId: entry.profile.sourceRevisionId,
          },
        }),
        cacheKey: `${entry.profile.entryId}:${entry.profile.sourceRevisionId}`,
        now,
      });
      this.dependencies.operations.markOperationRunning(operationId, now);
    });

    try {
      const output = await this.dependencies.runtime.executeLexicalLocalization({
        operationId,
        profile: entry.profile,
        ...(signal === undefined ? {} : { signal }),
      });
      const localizedAt = this.dependencies.clock.now();
      const localization: LexicalLocalization = {
        operationId,
        entryId: entry.profile.entryId,
        sourceRevisionId: entry.profile.sourceRevisionId,
        ...output,
        localizedAt,
      };
      this.dependencies.transaction.run(() => {
        this.dependencies.repository.saveLocalization(localization, localizedAt);
        this.dependencies.operations.completeOperation(operationId, localizedAt);
      });
      return localization;
    } catch (error) {
      const applicationError = error instanceof ApplicationError
        ? error
        : new ApplicationError({
            code: "MODEL_PROVIDER_FAILED",
            message: "词汇资料中文本地化失败",
            statusCode: 502,
            retryable: true,
            cause: error,
          });
      this.dependencies.transaction.run(() => {
        if (applicationError.code === "OPERATION_CANCELLED") {
          this.dependencies.operations.cancelOperation(operationId, this.dependencies.clock.now());
        } else {
          this.dependencies.operations.failOperation(
            operationId,
            applicationError.code,
            applicationError.message,
            this.dependencies.clock.now(),
          );
        }
      });
      if (applicationError.code === "OPERATION_CANCELLED") throw applicationError;
      return null;
    }
  }
}
