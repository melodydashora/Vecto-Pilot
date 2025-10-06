
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

// Essential files for running the app
const ESSENTIAL_FILES = [
  // Root config
  "package.json",
  "tsconfig.json",
  "drizzle.config.ts",
  "tailwind.config.js",
  "postcss.config.js",
  "vite.config.js",
  
  // Documentation
  "README.md",
  "VECTO_BUILD_DOCUMENTATION.md",
  "LEXICON.md",
  
  // Main server files
  "gateway-server.js",
  "index.js",
  
  // Client source (all files)
  "client/src/**/*",
  "client/index.html",
  "client/postcss.config.js",
  "client/tsconfig.json",
  "client/vite.config.ts",
  
  // Server source (all files)
  "server/**/*.js",
  "server/**/*.ts",
  "server/**/*.json",
  "server/**/*.sql",
  
  // Shared types
  "shared/**/*.ts",
  "shared/**/*.js",
  
  // Environment example
  ".env.example"
];

// Files/directories to explicitly exclude
const EXCLUDE = [
  "node_modules",
  ".replit",
  ".replit-assistant-override.json",
  "replit.nix",
  ".config",
  ".local",
  ".cache",
  ".upm",
  ".npm",
  "dist",
  "build",
  "vecto-evidence",
  "warehouse",
  "tests",
  "attached_assets",
  "data/context-snapshots",
  "data/agent-logs",
  ".git",
  "*.zip",
  "*.log"
];

const root = process.cwd();
const OUTDIR = path.join(root, "vecto-clean-repo");
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
const ZIP_NAME = `vecto-clean-${timestamp}.zip`;

// Helper to check if path should be excluded
function shouldExclude(filePath) {
  const relativePath = path.relative(root, filePath);
  return EXCLUDE.some(pattern => {
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return regex.test(relativePath);
    }
    return relativePath.startsWith(pattern) || relativePath.includes(`/${pattern}`);
  });
}

// Recursively copy directory
async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (shouldExclude(srcPath)) continue;
    
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// Main export function
async function exportCleanRepo() {
  console.log("🧹 Creating clean repository export...\n");
  
  // Clean output directory
  await fs.rm(OUTDIR, { recursive: true, force: true });
  await fs.mkdir(OUTDIR, { recursive: true });
  
  const copied = [];
  
  // Copy essential files
  for (const pattern of ESSENTIAL_FILES) {
    if (pattern.includes('**')) {
      // Handle glob patterns for directories
      const [dir] = pattern.split('/**');
      const srcDir = path.join(root, dir);
      const destDir = path.join(OUTDIR, dir);
      
      try {
        await copyDir(srcDir, destDir);
        copied.push(dir + '/ (directory)');
        console.log(`✓ Copied ${dir}/`);
      } catch (err) {
        console.log(`⚠ Skipped ${dir}/ (not found)`);
      }
    } else {
      // Handle individual files
      const src = path.join(root, pattern);
      const dest = path.join(OUTDIR, pattern);
      
      try {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(src, dest);
        copied.push(pattern);
        console.log(`✓ Copied ${pattern}`);
      } catch (err) {
        console.log(`⚠ Skipped ${pattern} (not found)`);
      }
    }
  }
  
  // Create installation instructions
  const instructions = `# Vecto Pilot - Clean Repository

## Quick Start

1. **Install dependencies:**
   \`\`\`bash
   npm install
   \`\`\`

2. **Set up environment:**
   - Copy \`.env.example\` to \`.env\`
   - Add your API keys:
     - ANTHROPIC_API_KEY
     - GOOGLE_MAPS_API_KEY
     - OPENWEATHER_API_KEY
     - GOOGLEAQ_API_KEY
     - DATABASE_URL (PostgreSQL)

3. **Run database migrations:**
   \`\`\`bash
   npx drizzle-kit push
   \`\`\`

4. **Build client:**
   \`\`\`bash
   npm run build
   \`\`\`

5. **Start server:**
   \`\`\`bash
   NODE_ENV=production node gateway-server.js
   \`\`\`

## Development Mode

\`\`\`bash
NODE_ENV=development node gateway-server.js
\`\`\`

Server runs on port 5000 (configurable via PORT env var).

## Key Files

- **gateway-server.js**: Main server (proxies API + serves React app)
- **client/**: React frontend (Vite + TypeScript)
- **server/**: Express API routes
- **shared/**: Shared types and database schema
- **VECTO_BUILD_DOCUMENTATION.md**: Architecture documentation

## Environment Variables

See \`.env.example\` for all required configuration.

## Notes

- PostgreSQL database required for ML features
- Google Maps API used for geocoding and directions
- Anthropic Claude API for AI recommendations
`;

  await fs.writeFile(path.join(OUTDIR, "INSTALLATION.md"), instructions);
  console.log("\n✓ Created INSTALLATION.md");
  
  // Create manifest
  const manifest = {
    exported_at: new Date().toISOString(),
    files_copied: copied.length,
    files: copied.sort(),
    excluded: EXCLUDE,
    notes: "Clean repository export without node_modules, Replit configs, or build artifacts"
  };
  
  await fs.writeFile(
    path.join(OUTDIR, "EXPORT_MANIFEST.json"), 
    JSON.stringify(manifest, null, 2)
  );
  console.log("✓ Created EXPORT_MANIFEST.json");
  
  // Create zip
  console.log("\n📦 Creating zip archive...");
  try {
    execSync(`cd "${OUTDIR}" && zip -r ../${ZIP_NAME} . -q`);
    console.log(`✓ Created ${ZIP_NAME}`);
  } catch (err) {
    console.error("⚠ Zip creation failed, but files are in:", OUTDIR);
  }
  
  // Summary
  const stats = await fs.stat(path.join(root, ZIP_NAME)).catch(() => null);
  const zipSize = stats ? (stats.size / 1024 / 1024).toFixed(2) + " MB" : "N/A";
  
  console.log("\n" + "=".repeat(50));
  console.log("✅ EXPORT COMPLETE");
  console.log("=".repeat(50));
  console.log(`📁 Directory: ${OUTDIR}`);
  console.log(`📦 Zip file: ${ZIP_NAME}`);
  console.log(`📊 Size: ${zipSize}`);
  console.log(`📄 Files: ${copied.length}`);
  console.log("\n📋 What's included:");
  console.log("  ✓ Source code (client/, server/, shared/)");
  console.log("  ✓ Configuration files");
  console.log("  ✓ Database schema");
  console.log("  ✓ Documentation");
  console.log("\n🚫 What's excluded:");
  console.log("  ✗ node_modules/ (reinstall with npm install)");
  console.log("  ✗ Replit configs (.replit, replit.nix)");
  console.log("  ✗ Build artifacts (dist/, .cache/)");
  console.log("  ✗ Test data and logs");
  console.log("\n💡 Share the .zip file with GPT-5 Pro for analysis");
}

// Run export
exportCleanRepo().catch(err => {
  console.error("❌ Export failed:", err);
  process.exit(1);
});
