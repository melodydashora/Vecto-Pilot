import { defineConfig } from "drizzle-kit";

// Replit Managed PostgreSQL Database - ONLY SOURCE
// DATABASE_URL is automatically injected by Replit for all environments (dev + production)
// No external databases (Neon, Vercel, Railway, etc.) are used
const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  throw new Error("❌ DATABASE_URL is missing - Replit PostgreSQL must be enabled");
}

export default defineConfig({
  schema: "./shared/schema.js",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
});
