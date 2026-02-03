-- ⚠️ DEPRECATED - DO NOT EDIT
-- This file is kept for historical reference only
-- Current schema source of truth: shared/schema.js (Drizzle ORM)
-- To generate migrations: npm run db:generate
-- To apply migrations: npm run db:migrate

-- Vecto Pilot - Initial Schema Migration (DEPRECATED)

-- Enable pgvector extension (compatible with 0.8.0)
CREATE EXTENSION IF NOT EXISTS vector;

-- Create documents table with vector embeddings
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for vector similarity search (0.8.0 compatible)
-- Note: IVFFlat may not be available in older versions, using basic index
CREATE INDEX IF NOT EXISTS documents_embedding_idx
  ON documents
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- If above fails, fallback to basic index (uncomment if needed):
-- CREATE INDEX IF NOT EXISTS documents_embedding_idx ON documents (embedding);

-- Analyze table for query optimization
ANALYZE documents;