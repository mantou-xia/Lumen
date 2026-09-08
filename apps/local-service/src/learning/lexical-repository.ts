import {
  lexicalLocalizationSchema,
  lexicalProfileSchema,
  type LexicalLocalization,
} from "@lumen/api-contract";
import type { DatabaseSync } from "node:sqlite";

import type {
  CachedLexicalEntry,
  LexicalRepositoryPort,
} from "../application/ports.js";
import { wiktionaryParserVersion } from "../lexical/wiktionary-parser.js";

const licenseId = "CC-BY-SA-4.0-OR-GFDL";
const attributionText = "Source: English Wiktionary contributors; licensed under CC BY-SA 4.0 and GFDL.";

export class LexicalRepository implements LexicalRepositoryPort {
  constructor(private readonly connection: DatabaseSync) {}

  findByNormalizedLemma(normalizedLemma: string): CachedLexicalEntry | null {
    const row = this.connection.prepare(`
      SELECT e.normalized_lemma, e.raw_wikitext_snapshot, p.profile_snapshot,
        l.localization_snapshot
      FROM lexical_entries e
      JOIN lexical_profiles p ON p.entry_id = e.id
      LEFT JOIN lexical_localizations l
        ON l.entry_id = e.id AND l.source_revision_id = e.source_revision_id
      WHERE e.source = 'en.wiktionary' AND e.language = 'en' AND e.normalized_lemma = ?
      LIMIT 1
    `).get(normalizedLemma) as unknown as LexicalRow | undefined;
    if (row === undefined) return null;
    return {
      normalizedLemma: row.normalized_lemma,
      rawWikitext: row.raw_wikitext_snapshot,
      profile: lexicalProfileSchema.parse(JSON.parse(row.profile_snapshot)),
      localization: row.localization_snapshot === null
        ? null
        : lexicalLocalizationSchema.parse(JSON.parse(row.localization_snapshot)),
    };
  }

  saveProfile(input: {
    normalizedLemma: string;
    rawWikitext: string;
    profile: CachedLexicalEntry["profile"];
    now: string;
  }): void {
    const existing = this.connection.prepare(`
      SELECT id, source_revision_id FROM lexical_entries
      WHERE source = 'en.wiktionary' AND language = 'en' AND normalized_lemma = ?
    `).get(input.normalizedLemma) as unknown as ExistingEntryRow | undefined;

    if (existing !== undefined && existing.source_revision_id !== input.profile.sourceRevisionId) {
      this.connection.prepare("DELETE FROM lexical_localizations WHERE entry_id = ?").run(existing.id);
    }

    this.connection.prepare(`
      INSERT INTO lexical_entries (
        id, source, language, lemma, normalized_lemma, source_revision_id,
        source_revision_timestamp, source_url, license_id, attribution_text,
        raw_wikitext_snapshot, fetched_at, updated_at
      ) VALUES (?, 'en.wiktionary', 'en', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, language, normalized_lemma) DO UPDATE SET
        lemma = excluded.lemma,
        source_revision_id = excluded.source_revision_id,
        source_revision_timestamp = excluded.source_revision_timestamp,
        source_url = excluded.source_url,
        license_id = excluded.license_id,
        attribution_text = excluded.attribution_text,
        raw_wikitext_snapshot = excluded.raw_wikitext_snapshot,
        fetched_at = excluded.fetched_at,
        updated_at = excluded.updated_at
    `).run(
      existing?.id ?? input.profile.entryId,
      input.profile.lemma,
      input.normalizedLemma,
      input.profile.sourceRevisionId,
      input.profile.sourceRevisionTimestamp,
      input.profile.sourceUrl,
      licenseId,
      attributionText,
      input.rawWikitext,
      input.profile.fetchedAt,
      input.now,
    );

    const entry = this.connection.prepare(`
      SELECT id FROM lexical_entries
      WHERE source = 'en.wiktionary' AND language = 'en' AND normalized_lemma = ?
    `).get(input.normalizedLemma) as unknown as { id: string };
    this.connection.prepare(`
      INSERT INTO lexical_profiles (
        entry_id, parser_version, profile_snapshot, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(entry_id) DO UPDATE SET
        parser_version = excluded.parser_version,
        profile_snapshot = excluded.profile_snapshot,
        updated_at = excluded.updated_at
    `).run(
      entry.id,
      wiktionaryParserVersion,
      JSON.stringify({ ...input.profile, entryId: entry.id }),
      input.now,
      input.now,
    );
  }

  saveLocalization(localization: LexicalLocalization, now: string): void {
    this.connection.prepare(`
      INSERT INTO lexical_localizations (
        entry_id, operation_id, source_revision_id, localizer_version,
        localization_snapshot, created_at, updated_at
      ) VALUES (?, ?, ?, 'lexical-localization.v1', ?, ?, ?)
      ON CONFLICT(entry_id) DO UPDATE SET
        operation_id = excluded.operation_id,
        source_revision_id = excluded.source_revision_id,
        localizer_version = excluded.localizer_version,
        localization_snapshot = excluded.localization_snapshot,
        updated_at = excluded.updated_at
    `).run(
      localization.entryId,
      localization.operationId,
      localization.sourceRevisionId,
      JSON.stringify(localization),
      now,
      now,
    );
  }
}

interface LexicalRow {
  normalized_lemma: string;
  raw_wikitext_snapshot: string;
  profile_snapshot: string;
  localization_snapshot: string | null;
}

interface ExistingEntryRow {
  id: string;
  source_revision_id: string;
}
