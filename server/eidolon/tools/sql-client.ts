import { getSharedPool } from '../../db/pool.js';
import pkg from 'pg';
const { Pool } = pkg;

interface QueryResult {
  rows: any[];
  rowCount: number;
  command: string;
}

export class SQLClient {
  private pool: any;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable not set');
    }
    
    // Use shared pool for connection pooling efficiency
    this.pool = getSharedPool();
    
    if (!this.pool) {
      // Fallback: Only used if shared pool unavailable
      console.warn('[sql-client] Shared pool unavailable - creating fallback pool');
      this.pool = new Pool({
        connectionString: databaseUrl,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      });
    }
  }

  async query(sql: string, params?: any[]): Promise<QueryResult> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return {
        rows: result.rows,
        rowCount: result.rowCount || 0,
        command: result.command
      };
    } finally {
      client.release();
    }
  }

  async execute(sql: string, params?: any[]): Promise<QueryResult> {
    return this.query(sql, params);
  }

  async getTableSchema(tableName?: string): Promise<any[]> {
    const query = tableName 
      ? `
        SELECT 
          table_name,
          column_name,
          data_type,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position;
      `
      : `
        SELECT 
          table_name,
          column_name,
          data_type,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position;
      `;
    
    const result = await this.query(query, tableName ? [tableName] : []);
    return result.rows;
  }

  async getTables(): Promise<string[]> {
    const result = await this.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    return result.rows.map(row => row.table_name);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createSQLClient(): SQLClient {
  return new SQLClient();
}
