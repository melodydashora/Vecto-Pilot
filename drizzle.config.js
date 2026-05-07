import { defineConfig } from "drizzle-kit";

// DATABASE_URL is automatically injected by Replit:
//   - dev workspace: Helium PostgreSQL 16 (local, no SSL)
//   - published deployment: Neon serverless Postgres (SSL required)
// drizzle-kit reads whichever URL is injected for the current environment.
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
