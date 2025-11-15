import { drizzle } from 'drizzle-orm/node-postgres';
import { getPool } from './connection-manager.js';
import * as schema from '../../shared/schema.js';

const pool = getPool();
export const db = drizzle(pool, { schema });
