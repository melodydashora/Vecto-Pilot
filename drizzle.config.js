import { defineConfig } from "drizzle-kit";

// Check for the URL provided by Replit
const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  throw new Error("DATABASE_URL is missing");
}

export default defineConfig({
  schema: "./shared/schema.js",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
});
