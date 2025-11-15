import { defineConfig } from "drizzle-kit";

// CRITICAL: Use DEV_DATABASE_URL for local development
const isProduction = process.env.REPLIT_DEPLOYMENT === '1' || process.env.REPLIT_DEPLOYMENT === 'true';
const dbUrl = isProduction ? process.env.DATABASE_URL : (process.env.DEV_DATABASE_URL || process.env.DATABASE_URL);

console.log(`[drizzle-config] Using ${isProduction ? 'PRODUCTION' : 'DEV'} database`);

export default defineConfig({
  schema: "./shared/schema.js",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
});
