/**
 * Database Tools (4 tools)
 *
 * sql_query, sql_execute, db_schema, db_tables
 */

import pg from 'pg';

const { Pool } = pg;
let pool = null;
let repoRoot = process.cwd();

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 5
    });
  }
  return pool;
}

export const databaseTools = {
  // ─────────────────────────────────────────────────────────────────────────
  // sql_query - Execute SELECT query and return results
  // ─────────────────────────────────────────────────────────────────────────
  sql_query: {
    category: 'database',
    description: 'Execute a SELECT query and return results.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL SELECT query' },
        params: { type: 'array', description: 'Query parameters for $1, $2, etc.' },
        limit: { type: 'number', default: 100, description: 'Max rows to return' }
      },
      required: ['query']
    },
    init(root) { repoRoot = root; },
    async execute({ query, params = [], limit = 100 }) {
      const db = getPool();
      if (!db) {
        throw new Error('DATABASE_URL not configured');
      }

      // Ensure it's a SELECT query for safety
      const normalizedQuery = query.trim().toLowerCase();
      if (!normalizedQuery.startsWith('select') && !normalizedQuery.startsWith('with')) {
        throw new Error('sql_query only supports SELECT queries. Use sql_execute for mutations.');
      }

      // Add LIMIT if not present
      let finalQuery = query;
      if (!normalizedQuery.includes('limit')) {
        finalQuery = `${query} LIMIT ${limit}`;
      }

      const result = await db.query(finalQuery, params);

      return {
        rows: result.rows,
        row_count: result.rowCount,
        fields: result.fields?.map(f => ({ name: f.name, type: f.dataTypeID }))
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // sql_execute - Execute INSERT/UPDATE/DELETE query
  // ─────────────────────────────────────────────────────────────────────────
  sql_execute: {
    category: 'database',
    description: 'Execute INSERT, UPDATE, or DELETE query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL query' },
        params: { type: 'array', description: 'Query parameters' },
        returning: { type: 'boolean', default: false, description: 'Return affected rows' }
      },
      required: ['query']
    },
    init(root) { repoRoot = root; },
    async execute({ query, params = [], returning = false }) {
      const db = getPool();
      if (!db) {
        throw new Error('DATABASE_URL not configured');
      }

      // Add RETURNING * if requested and not present
      let finalQuery = query;
      if (returning && !query.toLowerCase().includes('returning')) {
        finalQuery = `${query} RETURNING *`;
      }

      const result = await db.query(finalQuery, params);

      return {
        rows_affected: result.rowCount,
        rows: returning ? result.rows : undefined,
        command: result.command
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // db_schema - Get database schema information
  // ─────────────────────────────────────────────────────────────────────────
  db_schema: {
    category: 'database',
    description: 'Get schema information for a table.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name' },
        include_indexes: { type: 'boolean', default: false }
      },
      required: ['table']
    },
    init(root) { repoRoot = root; },
    async execute({ table, include_indexes = false }) {
      const db = getPool();
      if (!db) {
        throw new Error('DATABASE_URL not configured');
      }

      // Get columns
      const columnsResult = await db.query(`
        SELECT
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `, [table]);

      // Get primary key
      const pkResult = await db.query(`
        SELECT a.attname as column_name
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary
      `, [table]);

      // Get foreign keys
      const fkResult = await db.query(`
        SELECT
          kcu.column_name,
          ccu.table_name AS foreign_table,
          ccu.column_name AS foreign_column
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY'
      `, [table]);

      const schema = {
        table,
        columns: columnsResult.rows,
        primary_key: pkResult.rows.map(r => r.column_name),
        foreign_keys: fkResult.rows
      };

      if (include_indexes) {
        const indexResult = await db.query(`
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE tablename = $1
        `, [table]);
        schema.indexes = indexResult.rows;
      }

      return schema;
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // db_tables - List all database tables
  // ─────────────────────────────────────────────────────────────────────────
  db_tables: {
    category: 'database',
    description: 'List all tables in the database with row counts.',
    inputSchema: {
      type: 'object',
      properties: {
        schema: { type: 'string', default: 'public' },
        include_counts: { type: 'boolean', default: true }
      }
    },
    init(root) { repoRoot = root; },
    async execute({ schema = 'public', include_counts = true }) {
      const db = getPool();
      if (!db) {
        throw new Error('DATABASE_URL not configured');
      }

      const tablesResult = await db.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
        AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `, [schema]);

      const tables = [];
      for (const row of tablesResult.rows) {
        const table = { name: row.table_name };

        if (include_counts) {
          try {
            const countResult = await db.query(
              `SELECT COUNT(*) as count FROM "${row.table_name}"`
            );
            table.row_count = parseInt(countResult.rows[0].count);
          } catch {
            table.row_count = 'error';
          }
        }

        tables.push(table);
      }

      return {
        schema,
        tables,
        count: tables.length
      };
    }
  }
};
