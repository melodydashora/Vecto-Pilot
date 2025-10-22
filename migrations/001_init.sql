-- Enable pgvector (run once per database)
CREATE EXTENSION IF NOT EXISTS vector;

-- Documents with 1536-dim embedding (OpenAI text-embedding-3-small)
CREATE TABLE IF NOT EXISTS documents (
  id        TEXT PRIMARY KEY,
  content   TEXT NOT NULL,
  metadata  JSONB DEFAULT '{}'::jsonb,
  embedding vector(1536)
);

-- ANN index (fast KNN using IVFFlat with cosine distance)
CREATE INDEX IF NOT EXISTS documents_embedding_idx
  ON documents
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Analyze table for query optimization
ANALYZE documents;
