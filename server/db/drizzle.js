import { drizzle } from 'drizzle-orm/node-postgres';
import pool from './client.js';
import * as schema from '../../shared/schema.js';

export const db = drizzle(pool, { schema });
