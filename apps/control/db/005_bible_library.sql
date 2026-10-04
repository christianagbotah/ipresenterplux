BEGIN;

CREATE TABLE IF NOT EXISTS bible_versions (
  id text PRIMARY KEY,
  name text NOT NULL,
  abbreviation text NOT NULL,
  language_code text NOT NULL,
  license_kind text NOT NULL,
  source_url text,
  source_revision text,
  content_sha256 char(64),
  local_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bible_books (
  version_id text NOT NULL REFERENCES bible_versions(id) ON DELETE CASCADE,
  book_code text NOT NULL,
  canonical_name text NOT NULL,
  book_order integer NOT NULL,
  testament text NOT NULL CHECK (testament IN ('OT','NT')),
  PRIMARY KEY (version_id, book_code),
  UNIQUE (version_id, canonical_name)
);

CREATE TABLE IF NOT EXISTS bible_verses (
  version_id text NOT NULL,
  book_code text NOT NULL,
  chapter integer NOT NULL CHECK (chapter > 0),
  verse integer NOT NULL CHECK (verse > 0),
  text text NOT NULL,
  PRIMARY KEY (version_id, book_code, chapter, verse),
  FOREIGN KEY (version_id, book_code)
    REFERENCES bible_books(version_id, book_code)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bible_verses_lookup
  ON bible_verses(version_id, book_code, chapter, verse);

CREATE INDEX IF NOT EXISTS idx_bible_books_name
  ON bible_books(version_id, lower(canonical_name));

COMMIT;
