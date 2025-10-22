
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

const WANT = [
  "server/index.ts","server/index.js",
  "server/lib/env.ts","server/lib/env.js",
  "server/routes/blocks.ts","server/routes/blocks.js",
  "server/lib/strategy.ts","server/lib/strategy.js","server/routes/strategy.ts","server/routes/strategy.js",
  "server/routes/location/snapshot.ts","server/routes/location/snapshot.js","server/routes/snapshot.ts","server/routes/snapshot.js",
  "server/routes/actions.ts","server/routes/actions.js",
  "server/db/schema.ts","server/db/schema.js",
  "client/src/pages/co-pilot.tsx","client/src/pages/CoPilot.tsx",
  "client/src/context/LocationContext.tsx","client/src/context/location/LocationContext.tsx",
  "client/src/lib/apiRequest.ts",
  "client/src/lib/queryClient.ts",
  "client/src/components/FooterFunding.tsx",
  "client/public/robots.txt"
];

const root = process.cwd();
const OUTDIR = path.join(root, "vecto-evidence");
await fs.rm(OUTDIR, { recursive: true, force: true });
await fs.mkdir(OUTDIR, { recursive: true });

const copied = [];
for (const rel of WANT) {
  const variants = [rel, rel.replace(/\.ts$/, ".js"), rel.replace(/\.tsx$/, ".jsx")];
  let found = null;
  for (const v of variants) {
    try {
      await fs.stat(path.join(root, v));
      found = v; break;
    } catch {}
  }
  if (!found) continue;
  const dst = path.join(OUTDIR, found);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(path.join(root, found), dst);
  copied.push(found);
}

await fs.writeFile(path.join(OUTDIR, "MANIFEST.json"), JSON.stringify({ copied, time: new Date().toISOString() }, null, 2));
try { execSync(`cd "${OUTDIR}" && zip -r ../vecto-evidence.zip .`, { stdio: "ignore" }); } catch {}
console.log(JSON.stringify({ out_zip: "vecto-evidence.zip", files: copied }, null, 2));
