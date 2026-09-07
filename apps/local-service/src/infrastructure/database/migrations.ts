export interface DatabaseMigration {
  version: number;
  name: string;
  sql: string;
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
];
