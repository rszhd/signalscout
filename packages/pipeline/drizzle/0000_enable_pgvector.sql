-- pgvector holds the embeddings the pre-filter compares (US-008). The
-- extension ships with the Postgres image; this makes it available in the
-- database, and proves at boot that the image is the right one.
CREATE EXTENSION IF NOT EXISTS vector;
