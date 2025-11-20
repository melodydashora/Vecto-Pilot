import { defineConfig } from "drizzle-kit";

// Replit DATABASE_URL automatically switches between dev and prod
const dbUrl = process.env.DATABASE_URL;
const isProduction = process.env.REPLIT_DEPLOYMENT === '1' || process.env.DEPLOY_MODE === 'webservice';

console.log(`[drizzle-config] Using ${isProduction ? 'PRODUCTION' : 'DEV'} database (Replit auto-switches)`);

export default defineConfig({
  schema: "./shared/schema.js",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
});
