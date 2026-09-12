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
            'code', 'table', 'table_cell', 'image', 'separator'
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
  {
    version: 16,
    name: "book_composition_and_reading_progress",
    sql: `
      CREATE TABLE books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        format_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ready', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE book_pages (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
        page_order INTEGER NOT NULL CHECK (page_order >= 0),
        created_at TEXT NOT NULL,
        UNIQUE(book_id, id),
        UNIQUE(book_id, document_id),
        UNIQUE(book_id, page_order)
      ) STRICT;

      CREATE INDEX book_pages_book_order_idx
      ON book_pages(book_id, page_order);

      CREATE TABLE book_reading_states (
        book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        active_page_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(book_id, active_page_id)
          REFERENCES book_pages(book_id, id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE book_page_progress (
        book_id TEXT NOT NULL,
        page_id TEXT NOT NULL,
        revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE RESTRICT,
        block_id TEXT NOT NULL REFERENCES semantic_blocks(id) ON DELETE RESTRICT,
        semantic_offset INTEGER NOT NULL CHECK (semantic_offset >= 0),
        page_progression REAL NOT NULL CHECK (page_progression >= 0 AND page_progression <= 1),
        saved_at TEXT NOT NULL,
        PRIMARY KEY(book_id, page_id),
        FOREIGN KEY(book_id, page_id)
          REFERENCES book_pages(book_id, id) ON DELETE CASCADE
      ) STRICT;
    `,
  },
  {
    version: 17,
    name: "workspace_sessions_and_semantic_search",
    disableForeignKeys: true,
    sql: `
      CREATE TABLE semantic_blocks_workspace_next (
        id TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE RESTRICT,
        block_type TEXT NOT NULL CHECK (
          block_type IN (
            'heading', 'paragraph', 'list_item', 'blockquote',
            'code', 'table', 'table_cell', 'image', 'separator'
          )
        ),
        block_order INTEGER NOT NULL CHECK (block_order >= 0),
        text TEXT NOT NULL,
        source_start_offset INTEGER NOT NULL CHECK (source_start_offset >= 0),
        source_end_offset INTEGER NOT NULL CHECK (source_end_offset >= source_start_offset),
        UNIQUE(revision_id, block_order)
      ) STRICT;

      INSERT INTO semantic_blocks_workspace_next (
        id, revision_id, block_type, block_order, text,
        source_start_offset, source_end_offset
      )
      SELECT id, revision_id, block_type, block_order, text,
        source_start_offset, source_end_offset
      FROM semantic_blocks;

      DROP TABLE semantic_blocks;
      ALTER TABLE semantic_blocks_workspace_next RENAME TO semantic_blocks;

      CREATE INDEX semantic_blocks_revision_order_idx
      ON semantic_blocks(revision_id, block_order);

      CREATE TABLE workspace_sessions_next (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
        revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE RESTRICT,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      INSERT INTO workspace_sessions_next (
        id, document_id, revision_id, title, created_at, updated_at
      )
      SELECT id, document_id, revision_id, '新会话', created_at, updated_at
      FROM workspace_sessions;

      DROP TABLE workspace_sessions;
      ALTER TABLE workspace_sessions_next RENAME TO workspace_sessions;

      CREATE INDEX workspace_sessions_revision_updated_idx
      ON workspace_sessions(document_id, revision_id, updated_at DESC, created_at DESC);

      CREATE TABLE workspace_turn_references_next (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL REFERENCES workspace_turns(id) ON DELETE CASCADE,
        reference_type TEXT NOT NULL CHECK (
          reference_type IN (
            'selection', 'paragraph', 'document_context', 'translation',
            'learning_context', 'annotation', 'workspace_turn'
          )
        ),
        target_id TEXT NOT NULL,
        reference_snapshot TEXT NOT NULL,
        reference_order INTEGER NOT NULL CHECK (reference_order >= 0),
        UNIQUE(turn_id, reference_order)
      ) STRICT;

      INSERT INTO workspace_turn_references_next (
        id, turn_id, reference_type, target_id, reference_snapshot, reference_order
      )
      SELECT id, turn_id, reference_type, target_id,
        CASE
          WHEN json_type(reference_snapshot, '$.sourceRole') IS NULL
            THEN json_set(reference_snapshot, '$.sourceRole', 'explicit')
          ELSE reference_snapshot
        END,
        reference_order
      FROM workspace_turn_references;

      DROP TABLE workspace_turn_references;
      ALTER TABLE workspace_turn_references_next RENAME TO workspace_turn_references;

      ALTER TABLE workspace_answers ADD COLUMN outcome TEXT NOT NULL DEFAULT 'answered'
        CHECK (outcome IN ('answered', 'insufficient_evidence'));
      ALTER TABLE workspace_answers ADD COLUMN context_mode TEXT NOT NULL DEFAULT 'explicit_references_only'
        CHECK (context_mode IN ('full_document', 'retrieved_document', 'explicit_references_only'));
      ALTER TABLE workspace_answers ADD COLUMN context_stats_snapshot TEXT NOT NULL
        DEFAULT '{"explicitReferenceCount":0,"retrievedBlockCount":0,"includedCharacterCount":0,"truncated":false}';
      ALTER TABLE workspace_answers ADD COLUMN context_references_snapshot TEXT NOT NULL DEFAULT '[]';

      CREATE VIRTUAL TABLE semantic_block_fts USING fts5(
        block_id UNINDEXED,
        revision_id UNINDEXED,
        text,
        tokenize = 'unicode61'
      );

      INSERT INTO semantic_block_fts(block_id, revision_id, text)
      SELECT id, revision_id, text FROM semantic_blocks WHERE trim(text) <> '';

      CREATE TRIGGER semantic_blocks_fts_insert AFTER INSERT ON semantic_blocks
      WHEN trim(new.text) <> '' BEGIN
        INSERT INTO semantic_block_fts(block_id, revision_id, text)
        VALUES (new.id, new.revision_id, new.text);
      END;

      CREATE TRIGGER semantic_blocks_fts_delete AFTER DELETE ON semantic_blocks BEGIN
        DELETE FROM semantic_block_fts WHERE block_id = old.id;
      END;

      CREATE TRIGGER semantic_blocks_fts_update AFTER UPDATE ON semantic_blocks BEGIN
        DELETE FROM semantic_block_fts WHERE block_id = old.id;
        INSERT INTO semantic_block_fts(block_id, revision_id, text)
        SELECT new.id, new.revision_id, new.text WHERE trim(new.text) <> '';
      END;
    `,
  },
  {
    version: 18,
    name: "developer_agent_debug_traces",
    sql: `
      CREATE TABLE agent_debug_traces (
        trace_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        request_snapshot TEXT NOT NULL,
        response_snapshot TEXT,
        error_snapshot TEXT,
        latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
        created_at TEXT NOT NULL,
        completed_at TEXT
      ) STRICT;

      CREATE INDEX agent_debug_traces_created_idx
      ON agent_debug_traces(created_at DESC);
    `,
  },
  {
    version: 19,
    name: "markdown_managed_images",
    sql: `
      CREATE TABLE markdown_images (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE CASCADE,
        source_url TEXT NOT NULL,
        alt_text TEXT NOT NULL,
        media_type TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        storage_key TEXT NOT NULL UNIQUE,
        content_hash TEXT,
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        state TEXT NOT NULL CHECK (state IN ('staging', 'committed', 'missing')),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX markdown_images_revision_idx
      ON markdown_images(revision_id, created_at, id);
    `,
  },
  {
    version: 20,
    name: "correlate_agent_debug_traces_with_runtime",
    sql: `
      ALTER TABLE agent_debug_traces ADD COLUMN operation_id TEXT;
      ALTER TABLE agent_debug_traces ADD COLUMN invocation_id TEXT;
      ALTER TABLE agent_debug_traces ADD COLUMN task_type TEXT;
      ALTER TABLE agent_debug_traces ADD COLUMN task_version TEXT;

      CREATE INDEX agent_debug_traces_operation_idx
      ON agent_debug_traces(operation_id, created_at DESC);

      CREATE UNIQUE INDEX agent_debug_traces_invocation_idx
      ON agent_debug_traces(invocation_id)
      WHERE invocation_id IS NOT NULL;
    `,
  },
  {
    version: 21,
    name: "daily_reading_automation",
    sql: `
      CREATE TABLE daily_reading_automations (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL UNIQUE REFERENCES books(id) ON DELETE CASCADE,
        interest_description TEXT NOT NULL,
        interest_profile_snapshot TEXT,
        local_time TEXT NOT NULL,
        time_zone TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        next_run_at TEXT NOT NULL,
        last_attempt_at TEXT,
        last_success_local_date TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX daily_reading_automations_due_idx
      ON daily_reading_automations(enabled, next_run_at);

      CREATE TABLE daily_reading_runs (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL REFERENCES daily_reading_automations(id) ON DELETE CASCADE,
        operation_id TEXT REFERENCES operations(id) ON DELETE SET NULL,
        trigger_reason TEXT NOT NULL CHECK (
          trigger_reason IN ('initial', 'scheduled', 'startup_catchup', 'manual_retry')
        ),
        scheduled_for TEXT NOT NULL,
        local_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('requested', 'running', 'completed', 'no_content', 'failed', 'interrupted')
        ),
        source_snapshot TEXT,
        document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
        page_id TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      ) STRICT;

      CREATE INDEX daily_reading_runs_automation_created_idx
      ON daily_reading_runs(automation_id, created_at DESC);

      CREATE UNIQUE INDEX daily_reading_runs_one_success_per_day_idx
      ON daily_reading_runs(automation_id, local_date)
      WHERE status = 'completed';

      CREATE TABLE document_sources (
        document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL,
        source_version TEXT NOT NULL,
        publisher TEXT NOT NULL,
        source_title TEXT NOT NULL,
        author TEXT,
        published_at TEXT,
        original_url TEXT NOT NULL,
        canonical_url TEXT NOT NULL UNIQUE,
        retrieved_at TEXT NOT NULL,
        attribution_snapshot TEXT NOT NULL
      ) STRICT;

      ALTER TABLE book_pages ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'
        CHECK (origin IN ('manual', 'folder_import', 'scheduled_reading'));
      ALTER TABLE book_pages ADD COLUMN viewed_at TEXT;
      ALTER TABLE book_pages ADD COLUMN daily_reading_run_id TEXT
        REFERENCES daily_reading_runs(id) ON DELETE SET NULL;

      CREATE UNIQUE INDEX book_pages_daily_reading_run_idx
      ON book_pages(daily_reading_run_id)
      WHERE daily_reading_run_id IS NOT NULL;

      ALTER TABLE markdown_images ADD COLUMN caption TEXT;
      ALTER TABLE markdown_images ADD COLUMN credit TEXT;
      ALTER TABLE markdown_images ADD COLUMN license_id TEXT;
      ALTER TABLE markdown_images ADD COLUMN source_page_url TEXT;
      ALTER TABLE markdown_images ADD COLUMN usage_basis TEXT;
    `,
  },
  {
    version: 22,
    name: "daily_reading_workflow_events",
    sql: `
      CREATE TABLE daily_reading_run_events (
        run_id TEXT NOT NULL REFERENCES daily_reading_runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        stage TEXT NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
        message TEXT NOT NULL,
        data_snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(run_id, sequence)
      ) STRICT;

      CREATE INDEX daily_reading_run_events_created_idx
      ON daily_reading_run_events(created_at DESC);
    `,
  },
  {
    version: 23,
    name: "reading_scenes_and_conversations",
    sql: `
      ALTER TABLE documents ADD COLUMN scene_id TEXT NOT NULL DEFAULT 'english_reading'
        CHECK (scene_id IN ('english_reading', 'technical_learning'));
      ALTER TABLE books ADD COLUMN scene_id TEXT NOT NULL DEFAULT 'english_reading'
        CHECK (scene_id IN ('english_reading', 'technical_learning'));

      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        scene_id TEXT NOT NULL CHECK (scene_id IN ('english_reading', 'technical_learning')),
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
        revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE RESTRICT,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX conversations_revision_updated_idx
      ON conversations(document_id, revision_id, updated_at DESC);

      CREATE TABLE conversation_turns (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        intent TEXT NOT NULL CHECK (
          intent IN ('explain', 'question', 'translate', 'summarize', 'compare', 'generate', 'verify')
        ),
        capability_id TEXT NOT NULL,
        footnote_eligible INTEGER NOT NULL CHECK (footnote_eligible IN (0, 1)),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX conversation_turns_conversation_created_idx
      ON conversation_turns(conversation_id, created_at);

      CREATE TABLE conversation_turn_references (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL REFERENCES conversation_turns(id) ON DELETE CASCADE,
        reference_type TEXT NOT NULL CHECK (
          reference_type IN ('current_selection', 'paragraph', 'conversation_turn')
        ),
        target_id TEXT,
        reference_snapshot TEXT NOT NULL,
        reference_order INTEGER NOT NULL CHECK (reference_order >= 0),
        UNIQUE(turn_id, reference_order)
      ) STRICT;

      CREATE TABLE conversation_answers (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL UNIQUE REFERENCES conversation_turns(id) ON DELETE CASCADE,
        operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id) ON DELETE RESTRICT,
        content TEXT NOT NULL,
        citation_reference_ids_snapshot TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('answered', 'insufficient_evidence')),
        knowledge_boundary TEXT NOT NULL CHECK (
          knowledge_boundary IN ('document_grounded', 'mixed', 'model_knowledge')
        ),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE ai_footnotes (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
        revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE RESTRICT,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL UNIQUE REFERENCES conversation_turns(id) ON DELETE CASCADE,
        capability_id TEXT NOT NULL,
        selection_fingerprint TEXT NOT NULL,
        selection_snapshot TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX ai_footnotes_active_selection_idx
      ON ai_footnotes(revision_id, selection_fingerprint, capability_id)
      WHERE status = 'active';

      CREATE INDEX ai_footnotes_revision_created_idx
      ON ai_footnotes(document_id, revision_id, created_at);
    `,
  },
];
