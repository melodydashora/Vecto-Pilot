/**
 * Memory & Context Tools (5 tools)
 * Based on Eidolon memory system
 *
 * memory_store, memory_retrieve, memory_search, memory_clear, context_get
 */

import pg from 'pg';

const { Pool } = pg;
let pool = null;
let repoRoot = process.cwd();

// In-memory fallback when no database
const memoryStore = new Map();

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 3
    });
  }
  return pool;
}

export const memoryTools = {
  // ─────────────────────────────────────────────────────────────────────────
  // memory_store - Store a memory/note for later retrieval
  // ─────────────────────────────────────────────────────────────────────────
  memory_store: {
    category: 'memory',
    description: 'Store a memory/note that persists across sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Unique key for this memory' },
        content: { type: 'string', description: 'Content to store' },
        metadata: { type: 'object', description: 'Additional metadata' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        ttl_hours: { type: 'number', description: 'Time to live in hours (optional)' }
      },
      required: ['key', 'content']
    },
    init(root) { repoRoot = root; },
    async execute({ key, content, metadata = {}, tags = [], ttl_hours }) {
      const db = getPool();
      const entry = {
        key,
        content,
        metadata,
        tags,
        created_at: new Date().toISOString(),
        expires_at: ttl_hours ? new Date(Date.now() + ttl_hours * 3600000).toISOString() : null
      };

      if (db) {
        // Store in database
        await db.query(`
          INSERT INTO mcp_memory (key, content, metadata, tags, expires_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (key) DO UPDATE SET
            content = EXCLUDED.content,
            metadata = EXCLUDED.metadata,
            tags = EXCLUDED.tags,
            expires_at = EXCLUDED.expires_at,
            updated_at = NOW()
        `, [key, content, JSON.stringify(metadata), tags, entry.expires_at]);
      } else {
        // In-memory fallback
        memoryStore.set(key, entry);
      }

      return {
        key,
        stored: true,
        storage: db ? 'database' : 'memory',
        expires_at: entry.expires_at
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // memory_retrieve - Retrieve a stored memory by key
  // ─────────────────────────────────────────────────────────────────────────
  memory_retrieve: {
    category: 'memory',
    description: 'Retrieve a stored memory by key.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key to retrieve' }
      },
      required: ['key']
    },
    init(root) { repoRoot = root; },
    async execute({ key }) {
      const db = getPool();

      if (db) {
        const result = await db.query(`
          SELECT key, content, metadata, tags, created_at, updated_at, expires_at
          FROM mcp_memory
          WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW())
        `, [key]);

        if (result.rows.length === 0) {
          return { key, found: false };
        }

        const row = result.rows[0];
        return {
          key,
          found: true,
          content: row.content,
          metadata: row.metadata,
          tags: row.tags,
          created_at: row.created_at,
          updated_at: row.updated_at
        };
      } else {
        const entry = memoryStore.get(key);
        if (!entry) {
          return { key, found: false };
        }
        if (entry.expires_at && new Date(entry.expires_at) < new Date()) {
          memoryStore.delete(key);
          return { key, found: false, reason: 'expired' };
        }
        return { key, found: true, ...entry };
      }
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // memory_search - Search memories by tags or content
  // ─────────────────────────────────────────────────────────────────────────
  memory_search: {
    category: 'memory',
    description: 'Search memories by tags or content keywords.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        limit: { type: 'number', default: 20 }
      }
    },
    init(root) { repoRoot = root; },
    async execute({ query, tags, limit = 20 }) {
      const db = getPool();

      if (db) {
        let sql = `
          SELECT key, content, metadata, tags, created_at
          FROM mcp_memory
          WHERE (expires_at IS NULL OR expires_at > NOW())
        `;
        const params = [];

        if (query) {
          params.push(`%${query}%`);
          sql += ` AND content ILIKE $${params.length}`;
        }

        if (tags && tags.length > 0) {
          params.push(tags);
          sql += ` AND tags && $${params.length}`;
        }

        params.push(limit);
        sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;

        const result = await db.query(sql, params);
        return {
          query,
          tags,
          results: result.rows,
          count: result.rows.length
        };
      } else {
        // In-memory search
        const results = [];
        for (const [key, entry] of memoryStore) {
          if (entry.expires_at && new Date(entry.expires_at) < new Date()) continue;

          let matches = true;
          if (query && !entry.content.toLowerCase().includes(query.toLowerCase())) {
            matches = false;
          }
          if (tags && tags.length > 0 && !tags.some(t => entry.tags?.includes(t))) {
            matches = false;
          }

          if (matches) {
            results.push({ key, ...entry });
            if (results.length >= limit) break;
          }
        }
        return { query, tags, results, count: results.length };
      }
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // memory_clear - Clear memories by key pattern or tags
  // ─────────────────────────────────────────────────────────────────────────
  memory_clear: {
    category: 'memory',
    description: 'Clear memories by key pattern, tags, or all.',
    inputSchema: {
      type: 'object',
      properties: {
        key_pattern: { type: 'string', description: 'Key pattern (supports % wildcard)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Clear by tags' },
        clear_all: { type: 'boolean', default: false },
        clear_expired: { type: 'boolean', default: false }
      }
    },
    init(root) { repoRoot = root; },
    async execute({ key_pattern, tags, clear_all = false, clear_expired = false }) {
      const db = getPool();
      let deleted = 0;

      if (db) {
        if (clear_all) {
          const result = await db.query('DELETE FROM mcp_memory');
          deleted = result.rowCount;
        } else if (clear_expired) {
          const result = await db.query('DELETE FROM mcp_memory WHERE expires_at < NOW()');
          deleted = result.rowCount;
        } else if (key_pattern) {
          const result = await db.query('DELETE FROM mcp_memory WHERE key LIKE $1', [key_pattern]);
          deleted = result.rowCount;
        } else if (tags && tags.length > 0) {
          const result = await db.query('DELETE FROM mcp_memory WHERE tags && $1', [tags]);
          deleted = result.rowCount;
        }
      } else {
        if (clear_all) {
          deleted = memoryStore.size;
          memoryStore.clear();
        } else {
          for (const [key, entry] of memoryStore) {
            let shouldDelete = false;
            if (clear_expired && entry.expires_at && new Date(entry.expires_at) < new Date()) {
              shouldDelete = true;
            }
            if (key_pattern && key.includes(key_pattern.replace(/%/g, ''))) {
              shouldDelete = true;
            }
            if (tags && tags.some(t => entry.tags?.includes(t))) {
              shouldDelete = true;
            }
            if (shouldDelete) {
              memoryStore.delete(key);
              deleted++;
            }
          }
        }
      }

      return { deleted, storage: db ? 'database' : 'memory' };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // context_get - Get current session/context information
  // ─────────────────────────────────────────────────────────────────────────
  context_get: {
    category: 'memory',
    description: 'Get current session context and environment information.',
    inputSchema: {
      type: 'object',
      properties: {
        include_env: { type: 'boolean', default: false, description: 'Include environment variables' },
        include_memory_stats: { type: 'boolean', default: true }
      }
    },
    init(root) { repoRoot = root; },
    async execute({ include_env = false, include_memory_stats = true }) {
      const context = {
        repo_root: repoRoot,
        cwd: process.cwd(),
        node_version: process.version,
        platform: process.platform,
        uptime_seconds: process.uptime(),
        timestamp: new Date().toISOString()
      };

      if (include_env) {
        context.env = {
          NODE_ENV: process.env.NODE_ENV,
          DATABASE_URL: process.env.DATABASE_URL ? '[configured]' : '[not set]',
          MCP_PORT: process.env.MCP_PORT,
          REPO_ROOT: process.env.REPO_ROOT
        };
      }

      if (include_memory_stats) {
        const db = getPool();
        if (db) {
          try {
            const result = await db.query(`
              SELECT COUNT(*) as total,
                     COUNT(CASE WHEN expires_at IS NOT NULL THEN 1 END) as with_expiry,
                     COUNT(CASE WHEN expires_at < NOW() THEN 1 END) as expired
              FROM mcp_memory
            `);
            context.memory_stats = {
              storage: 'database',
              ...result.rows[0]
            };
          } catch {
            context.memory_stats = { storage: 'database', error: 'table not found' };
          }
        } else {
          context.memory_stats = {
            storage: 'memory',
            total: memoryStore.size
          };
        }
      }

      return context;
    }
  }
};
