export interface DatabaseMigration {
  version: number;
  name: string;
  sql: string;
  disableForeignKeys?: boolean;
}

export const databaseMigrations: readonly DatabaseMigration[] = [
  {
    version: 1,
    name: "initial_application_metadata",
    sql: `
      CREATE TABLE application_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      INSERT INTO application_metadata (key, value, updated_at)
      VALUES ('application', 'lumen', CURRENT_TIMESTAMP);
    `,
  },
  {
    version: 2,
    name: "document_library",
    sql: `
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        format_id TEXT NOT NULL CHECK (format_id = 'markdown'),
        title TEXT NOT NULL,
        active_revision_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('ready', 'archived', 'unavailable')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE document_revisions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
        source_resource_id TEXT,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('importing', 'ready', 'unavailable')),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE document_resources (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
        revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE RESTRICT,
        role TEXT NOT NULL CHECK (role = 'source'),
        media_type TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        storage_key TEXT NOT NULL UNIQUE,
        content_hash TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        state TEXT NOT NULL CHECK (state IN ('staging', 'committed', 'missing')),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE import_operations (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (
          status IN (
            'requested',
            'receiving',
            'inspecting',
            'committing',
            'completed',
            'failed',
            'cancelled',
            'interrupted'
          )
        ),
        original_filename TEXT NOT NULL,
        staging_key TEXT,
        document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
        revision_id TEXT REFERENCES document_revisions(id) ON DELETE SET NULL,
        resource_id TEXT REFERENCES document_resources(id) ON DELETE SET NULL,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      ) STRICT;

      CREATE INDEX documents_status_updated_idx
      ON documents(status, updated_at DESC);

      CREATE INDEX import_operations_status_updated_idx
      ON import_operations(status, updated_at DESC);
    `,
  },
  {
    version: 3,
    name: "markdown_reader_projection",
    sql: `
      ALTER TABLE document_revisions ADD COLUMN adapter_version TEXT NOT NULL DEFAULT 'markdown.adapter.v1';
      ALTER TABLE document_revisions ADD COLUMN semantic_projection_version TEXT NOT NULL DEFAULT 'markdown.semantic.v1';
      ALTER TABLE document_revisions ADD COLUMN render_projection_version TEXT NOT NULL DEFAULT 'markdown.render.v1';
      ALTER TABLE document_revisions ADD COLUMN source_mapping_version TEXT NOT NULL DEFAULT 'markdown.source-map.v1';

      CREATE TABLE document_projections (
        revision_id TEXT PRIMARY KEY REFERENCES document_revisions(id) ON DELETE RESTRICT,
        render_html TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE semantic_blocks (
        id TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE RESTRICT,
        block_type TEXT NOT NULL CHECK (
          block_type IN ('heading', 'paragraph', 'list_item', 'blockquote', 'code', 'image', 'separator')
        ),
        block_order INTEGER NOT NULL CHECK (block_order >= 0),
        text TEXT NOT NULL,
        source_start_offset INTEGER NOT NULL CHECK (source_start_offset >= 0),
        source_end_offset INTEGER NOT NULL CHECK (source_end_offset >= source_start_offset),
        UNIQUE(revision_id, block_order)
      ) STRICT;

      CREATE INDEX semantic_blocks_revision_order_idx
      ON semantic_blocks(revision_id, block_order);

      CREATE TABLE document_outlines (
        id TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE RESTRICT,
        block_id TEXT NOT NULL REFERENCES semantic_blocks(id) ON DELETE RESTRICT,
        depth INTEGER NOT NULL CHECK (depth BETWEEN 1 AND 6),
        label TEXT NOT NULL,
        outline_order INTEGER NOT NULL CHECK (outline_order >= 0),
        UNIQUE(revision_id, outline_order)
      ) STRICT;

      CREATE TABLE reading_progress (
        document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE RESTRICT,
        revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE RESTRICT,
        block_id TEXT NOT NULL REFERENCES semantic_blocks(id) ON DELETE RESTRICT,
        semantic_offset INTEGER NOT NULL CHECK (semantic_offset >= 0),
        progression REAL NOT NULL CHECK (progression >= 0 AND progression <= 1),
        saved_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 4,
    name: "controlled_translation_runtime",
    sql: `
      CREATE TABLE operations (
        id TEXT PRIMARY KEY,
        task_type TEXT NOT NULL,
        task_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('requested', 'running', 'completed', 'failed', 'cancelled', 'interrupted')
        ),
        document_id TEXT REFERENCES documents(id) ON DELETE RESTRICT,
        revision_id TEXT REFERENCES document_revisions(id) ON DELETE RESTRICT,
        context_snapshot TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      ) STRICT;

      CREATE TABLE invocations (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
        attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')
        ),
        input_tokens INTEGER,
        output_tokens INTEGER,
        latency_ms INTEGER,
        error_code TEXT,
        error_message TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE(operation_id, attempt_number)
      ) STRICT;

      CREATE TABLE translations (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id) ON DELETE RESTRICT,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
        revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE RESTRICT,
        selection_id TEXT NOT NULL,
        start_block_id TEXT NOT NULL REFERENCES semantic_blocks(id) ON DELETE RESTRICT,
        start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
        end_block_id TEXT NOT NULL REFERENCES semantic_blocks(id) ON DELETE RESTRICT,
        end_offset INTEGER NOT NULL CHECK (end_offset >= 0),
        selected_text TEXT NOT NULL,
        selection_fingerprint TEXT NOT NULL,
        surrounding_context TEXT NOT NULL,
        contextual_translation TEXT NOT NULL,
        contextual_meaning TEXT NOT NULL,
        expression_type TEXT NOT NULL CHECK (
          expression_type IN ('word', 'phrase', 'collocation', 'sentence')
        ),
        explanation TEXT NOT NULL,
        uncertainty TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX translations_selection_idx
      ON translations(revision_id, selection_fingerprint, created_at DESC);
    `,
  },
  {
    version: 5,
    name: "expression_learning_context",
    sql: `
      CREATE TABLE expressions (
        id TEXT PRIMARY KEY,
        canonical_form TEXT NOT NULL,
        normalized_form TEXT NOT NULL,
        expression_type TEXT NOT NULL CHECK (
          expression_type IN ('word', 'phrase', 'collocation', 'sentence')
        ),
        language TEXT NOT NULL CHECK (language = 'en'),
        status TEXT NOT NULL CHECK (status IN ('active', 'familiar', 'archived')),
        user_note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX expressions_normalized_status_idx
      ON expressions(normalized_form, status);

      CREATE TABLE expression_variants (
        id TEXT PRIMARY KEY,
        expression_id TEXT NOT NULL REFERENCES expressions(id) ON DELETE RESTRICT,
        surface_pattern TEXT NOT NULL,
        normalized_pattern TEXT NOT NULL,
        variant_type TEXT NOT NULL CHECK (
          variant_type IN ('canonical', 'observed', 'inflection', 'user_defined')
        ),
        source TEXT NOT NULL CHECK (
          source IN ('learning_context', 'deterministic_normalizer', 'user')
        ),
        created_at TEXT NOT NULL,
        UNIQUE(expression_id, normalized_pattern)
      ) STRICT;

      CREATE INDEX expression_variants_normalized_idx
      ON expression_variants(normalized_pattern);

      CREATE TABLE learning_contexts (
        id TEXT PRIMARY KEY,
        expression_id TEXT NOT NULL REFERENCES expressions(id) ON DELETE RESTRICT,
        translation_id TEXT NOT NULL REFERENCES translations(id) ON DELETE RESTRICT,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
        revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE RESTRICT,
        start_block_id TEXT NOT NULL REFERENCES semantic_blocks(id) ON DELETE RESTRICT,
        start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
        end_block_id TEXT NOT NULL REFERENCES semantic_blocks(id) ON DELETE RESTRICT,
        end_offset INTEGER NOT NULL CHECK (end_offset >= 0),
        semantic_range_fingerprint TEXT NOT NULL,
        surface_form TEXT NOT NULL,
        surrounding_context_snapshot TEXT NOT NULL,
        translation_snapshot TEXT NOT NULL,
        translation_operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        created_at TEXT NOT NULL,
        UNIQUE(expression_id, revision_id, semantic_range_fingerprint)
      ) STRICT;
    `,
  },
  {
    version: 6,
    name: "reading_recall",
    sql: `
      CREATE TABLE recall_occurrences (
        id TEXT PRIMARY KEY,
        expression_id TEXT NOT NULL REFERENCES expressions(id) ON DELETE RESTRICT,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
        revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE RESTRICT,
        block_id TEXT NOT NULL REFERENCES semantic_blocks(id) ON DELETE RESTRICT,
        start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
        end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
        surface_form TEXT NOT NULL,
        current_context_snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(expression_id, revision_id, block_id, start_offset, end_offset)
      ) STRICT;

      CREATE TABLE recall_attempts (
        id TEXT PRIMARY KEY,
        occurrence_id TEXT NOT NULL REFERENCES recall_occurrences(id) ON DELETE RESTRICT,
        operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id) ON DELETE RESTRICT,
        user_interpretation TEXT NOT NULL,
        evaluation_snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 7,
    name: "revision_capabilities_and_source_mapping",
    sql: `
      ALTER TABLE document_revisions
      ADD COLUMN capabilities_snapshot TEXT NOT NULL DEFAULT '{"schemaVersion":1,"type":"document.capabilities","payload":{"selectableText":true,"stableSourceLocation":true,"nativeOutline":true,"pagination":false,"reflow":true,"originalLayout":false,"embeddedResources":false,"search":true,"annotations":true}}';

      CREATE TABLE source_mappings (
        id TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE RESTRICT,
        block_id TEXT NOT NULL REFERENCES semantic_blocks(id) ON DELETE RESTRICT,
        mapping_kind TEXT NOT NULL CHECK (mapping_kind = 'markdown_offset'),
        semantic_start_offset INTEGER NOT NULL CHECK (semantic_start_offset >= 0),
        semantic_end_offset INTEGER NOT NULL CHECK (semantic_end_offset >= semantic_start_offset),
        source_start_offset INTEGER NOT NULL CHECK (source_start_offset >= 0),
        source_end_offset INTEGER NOT NULL CHECK (source_end_offset >= source_start_offset),
        created_at TEXT NOT NULL,
        UNIQUE(revision_id, block_id, mapping_kind)
      ) STRICT;

      INSERT INTO source_mappings (
        id, revision_id, block_id, mapping_kind,
        semantic_start_offset, semantic_end_offset,
        source_start_offset, source_end_offset, created_at
      )
      SELECT
        revision_id || ':source-map:' || block_order,
        revision_id,
        id,
        'markdown_offset',
        0,
        length(text),
        source_start_offset,
        source_end_offset,
        CURRENT_TIMESTAMP
      FROM semantic_blocks;

      CREATE INDEX source_mappings_revision_block_idx
      ON source_mappings(revision_id, block_id);
    `,
  },
  {
    version: 8,
    name: "operation_query_and_event_sequence",
    sql: `
      ALTER TABLE operations ADD COLUMN previous_operation_id TEXT REFERENCES operations(id) ON DELETE SET NULL;
      ALTER TABLE operations ADD COLUMN cache_key TEXT;
      ALTER TABLE operations ADD COLUMN latest_sequence INTEGER NOT NULL DEFAULT 0 CHECK (latest_sequence >= 0);

      CREATE INDEX operations_previous_operation_idx
      ON operations(previous_operation_id);

      CREATE INDEX operations_cache_key_idx
      ON operations(task_type, task_version, cache_key, status);

      CREATE TABLE operation_events (
        operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        event_type TEXT NOT NULL,
        payload_snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(operation_id, sequence)
      ) STRICT;
    `,
  },
  {
    version: 9,
    name: "revision_update_import_kind",
    sql: `
      ALTER TABLE import_operations
      ADD COLUMN import_kind TEXT NOT NULL DEFAULT 'new_document'
      CHECK (import_kind IN ('new_document', 'revision_update'));
    `,
  },
  {
    version: 10,
    name: "wiktionary_lexical_profiles",
    sql: `
      CREATE TABLE lexical_entries (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK (source = 'en.wiktionary'),
        language TEXT NOT NULL CHECK (language = 'en'),
        lemma TEXT NOT NULL,
        normalized_lemma TEXT NOT NULL,
        source_revision_id TEXT NOT NULL,
        source_revision_timestamp TEXT NOT NULL,
        source_url TEXT NOT NULL,
        license_id TEXT NOT NULL CHECK (license_id = 'CC-BY-SA-4.0-OR-GFDL'),
        attribution_text TEXT NOT NULL,
        raw_wikitext_snapshot TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source, language, normalized_lemma)
      ) STRICT;

      CREATE TABLE lexical_profiles (
        entry_id TEXT PRIMARY KEY REFERENCES lexical_entries(id) ON DELETE RESTRICT,
        parser_version TEXT NOT NULL,
        profile_snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE lexical_localizations (
        entry_id TEXT PRIMARY KEY REFERENCES lexical_entries(id) ON DELETE RESTRICT,
        operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id) ON DELETE RESTRICT,
        source_revision_id TEXT NOT NULL,
        localizer_version TEXT NOT NULL,
        localization_snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX lexical_entries_normalized_idx
      ON lexical_entries(language, normalized_lemma);
    `,
  },
  {
    version: 11,
    name: "learning_library_detail_and_notes",
    sql: `
      ALTER TABLE learning_contexts ADD COLUMN user_note TEXT;
      ALTER TABLE learning_contexts ADD COLUMN updated_at TEXT;

      UPDATE learning_contexts
      SET updated_at = created_at
      WHERE updated_at IS NULL;

      CREATE TABLE expression_status_history (
        id TEXT PRIMARY KEY,
        expression_id TEXT NOT NULL REFERENCES expressions(id) ON DELETE RESTRICT,
        previous_status TEXT NOT NULL CHECK (previous_status IN ('active', 'familiar', 'archived')),
        next_status TEXT NOT NULL CHECK (next_status IN ('active', 'familiar', 'archived')),
        changed_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX expressions_status_updated_idx
      ON expressions(status, updated_at DESC);

      CREATE INDEX learning_contexts_expression_status_created_idx
      ON learning_contexts(expression_id, status, created_at DESC);

      CREATE INDEX expression_status_history_expression_changed_idx
      ON expression_status_history(expression_id, changed_at DESC);
    `,
  },
  {
    version: 12,
    name: "reader_annotations",
    sql: `
      CREATE TABLE annotations (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
        revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE RESTRICT,
        start_block_id TEXT NOT NULL REFERENCES semantic_blocks(id) ON DELETE RESTRICT,
        start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
        end_block_id TEXT NOT NULL REFERENCES semantic_blocks(id) ON DELETE RESTRICT,
        end_offset INTEGER NOT NULL CHECK (end_offset >= 0),
        semantic_range_fingerprint TEXT NOT NULL,
        selected_text_snapshot TEXT NOT NULL,
        source_ranges_snapshot TEXT NOT NULL,
        note TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('selection', 'translation', 'learning_context')),
        source_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX annotations_revision_status_start_idx
      ON annotations(revision_id, status, start_block_id, start_offset);

      CREATE INDEX annotations_document_updated_idx
      ON annotations(document_id, updated_at DESC);
    `,
  },
  {
    version: 13,
    name: "runtime_cache_and_finish_telemetry",
    sql: `
      ALTER TABLE invocations ADD COLUMN finish_reason TEXT;

      CREATE TABLE runtime_cache_hits (
        id INTEGER PRIMARY KEY,
        task_type TEXT NOT NULL,
        task_version TEXT NOT NULL,
        cache_key TEXT NOT NULL,
        source_operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
        hit_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX runtime_cache_hits_source_operation_idx
      ON runtime_cache_hits(source_operation_id, hit_at DESC);
    `,
  },
  {
    version: 14,
    name: "contextual_workspace",
    sql: `
      CREATE TABLE workspace_sessions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
        revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(document_id, revision_id)
      ) STRICT;

      CREATE TABLE workspace_turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE workspace_turn_references (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL REFERENCES workspace_turns(id) ON DELETE CASCADE,
        reference_type TEXT NOT NULL CHECK (
          reference_type IN (
            'selection', 'paragraph', 'translation',
            'learning_context', 'annotation', 'workspace_turn'
          )
        ),
        target_id TEXT NOT NULL,
        reference_snapshot TEXT NOT NULL,
        reference_order INTEGER NOT NULL CHECK (reference_order >= 0),
        UNIQUE(turn_id, reference_order)
      ) STRICT;

      CREATE TABLE workspace_answers (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL UNIQUE REFERENCES workspace_turns(id) ON DELETE CASCADE,
        operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id) ON DELETE RESTRICT,
        content TEXT NOT NULL,
        citation_reference_ids_snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX workspace_turns_session_created_idx
      ON workspace_turns(session_id, created_at);
    `,
  },
  {
    version: 15,
    name: "semantic_table_blocks",
    disableForeignKeys: true,
    sql: `
      CREATE TABLE semantic_blocks_next (
        id TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE RESTRICT,
        block_type TEXT NOT NULL CHECK (
          block_type IN (
            'heading', 'paragraph', 'list_item', 'blockquote',
            'code', 'table', 'image', 'separator'
          )
        ),
        block_order INTEGER NOT NULL CHECK (block_order >= 0),
        text TEXT NOT NULL,
        source_start_offset INTEGER NOT NULL CHECK (source_start_offset >= 0),
        source_end_offset INTEGER NOT NULL CHECK (source_end_offset >= source_start_offset),
        UNIQUE(revision_id, block_order)
      ) STRICT;

      INSERT INTO semantic_blocks_next (
        id, revision_id, block_type, block_order, text,
        source_start_offset, source_end_offset
      )
      SELECT
        id, revision_id, block_type, block_order, text,
        source_start_offset, source_end_offset
      FROM semantic_blocks;

      DROP TABLE semantic_blocks;
      ALTER TABLE semantic_blocks_next RENAME TO semantic_blocks;

      CREATE INDEX semantic_blocks_revision_order_idx
      ON semantic_blocks(revision_id, block_order);
    `,
  },
];
