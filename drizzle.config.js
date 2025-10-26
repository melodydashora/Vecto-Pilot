import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./shared/schema.js",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
