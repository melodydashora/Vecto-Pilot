import fs from "fs/promises";
import path from "path";

const BASE_DIR = process.env.BASE_DIR || process.cwd();
const ALLOWED_CONFIG_FILES = [
  // Environment files
  ".env",
  ".env.local",
  ".env.example",
  ".env.production",
  ".env.development",
  
  // Replit config
  ".replit",
  "replit.nix",
  ".replit.nix",
  ".replit-assistant-override.json",
  
  // Package management
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  
  // Build & bundler configs
  "drizzle.config.ts",
  "drizzle.config.js",
  "vite.config.ts",
  "vite.config.js",
  "tailwind.config.ts",
  "tailwind.config.js",
  "postcss.config.js",
  "postcss.config.cjs",
  
  // TypeScript configs
  "tsconfig.json",
  "tsconfig.node.json",
  "tsconfig.app.json",
  
  // Linting & formatting
  "eslint.config.js",
  ".eslintrc.json",
  ".eslintrc.js",
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.js",
  
  // Git & Docker
  ".gitignore",
  ".dockerignore",
  "Dockerfile",
  "docker-compose.yml",
  
  // Monorepo tools
  "nx.json",
  "turbo.json",
  "lerna.json",
  
  // Testing
  "jest.config.js",
  "vitest.config.ts",
  "playwright.config.ts",
  
  // Root config files
  "gateway-server.js",
  "agent-server.js",
  "index.js",
  
  // Assistant & Eidolon configs
  "config/assistant-policy.json",
  "server/config/assistant-policy.json",
  
  // Documentation
  "README.md",
  "ARCHITECTURE.md",
  "ISSUES.md",
  "replit.md",
];

export async function readConfigFile(filename) {
  if (!ALLOWED_CONFIG_FILES.includes(filename)) {
    throw new Error(`Config file not allowed: ${filename}`);
  }
  
  const filePath = path.join(BASE_DIR, filename);
  try {
    const content = await fs.readFile(filePath, "utf8");
    return { ok: true, filename, content, path: filePath };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { ok: false, error: "file_not_found", filename };
    }
    throw err;
  }
}

export async function updateEnvFile(updates) {
  const envPath = path.join(BASE_DIR, ".env");
  let content = "";
  
  try {
    content = await fs.readFile(envPath, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  
  const lines = content.split("\n");
  const updatedKeys = new Set();
  const newLines = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      newLines.push(line);
      continue;
    }
    
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      newLines.push(line);
      continue;
    }
    
    const key = trimmed.substring(0, eqIndex).trim();
    
    if (key in updates) {
      newLines.push(`${key}=${updates[key]}`);
      updatedKeys.add(key);
    } else {
      newLines.push(line);
    }
  }
  
  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      newLines.push(`${key}=${value}`);
    }
  }
  
  const newContent = newLines.join("\n");
  await fs.writeFile(envPath, newContent, "utf8");
  
  return {
    ok: true,
    updated: Object.keys(updates),
    path: envPath,
  };
}

export async function getEnvValue(key) {
  const envPath = path.join(BASE_DIR, ".env");
  try {
    const content = await fs.readFile(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith(key + "=")) {
        return trimmed.substring(key.length + 1);
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function listConfigFiles() {
  const files = [];
  for (const filename of ALLOWED_CONFIG_FILES) {
    const filePath = path.join(BASE_DIR, filename);
    try {
      const stats = await fs.stat(filePath);
      files.push({
        filename,
        path: filePath,
        size: stats.size,
        modified: stats.mtime,
        exists: true,
      });
    } catch {
      files.push({
        filename,
        path: filePath,
        exists: false,
      });
    }
  }
  return files;
}

export async function backupConfigFile(filename) {
  if (!ALLOWED_CONFIG_FILES.includes(filename)) {
    throw new Error(`Config file not allowed: ${filename}`);
  }
  
  const filePath = path.join(BASE_DIR, filename);
  const backupPath = path.join(BASE_DIR, `${filename}.backup-${Date.now()}`);
  
  try {
    await fs.copyFile(filePath, backupPath);
    return { ok: true, original: filePath, backup: backupPath };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { ok: false, error: "file_not_found" };
    }
    throw err;
  }
}
