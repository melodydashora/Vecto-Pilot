# Security Incident  Vecto-Pilot Credential Leak Audit
**Generated:** 2026-04-23 (during Claude Code agent session that exited mid-task)
**Repo:** github.com/melodydashora/Vecto-Pilot (PUBLIC)
**Trigger:** GCP project suspended ("abusive activity consistent with hijacking")

## Confirmed Leak Surface
The repo is pushed to a PUBLIC GitHub mirror  Google's automated scanners (and any attacker) can index it. The "remove hardcoded key" commits do NOT scrub git history; old blobs remain reachable forever via commit SHAs and GitHub events API.

## Confirmed Leaked Credentials (in public git history)

### 1. GCP / Google API Key (HIGHEST PRIORITY  explains the suspension)
- Key: `<LEAKED-GCP-KEY-A>`
- Used as: `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_MAPS_API_KEY`
- Introduction commits: `43b2ae09`, `0ff72024`, `e9e37cdd`, others
- Removal commit: `796e6b4d` "Remove hardcoded Gemini API key"  but the blob remains in history
- Project: `quantum-fusion-486920-p2`
- Service account email: `vertex-express@quantum-fusion-486920-p2.iam.gserviceaccount.com`

### 2. Private Key File  `keys/private.pem`
- **CRITICAL:** Still on disk at `/home/runner/workspace/keys/private.pem` (1704 bytes, mode 600)
- SHA256 of current file matches the leaked-on-GitHub blob exactly (same key)
- Added in commits: `6bc4c201`, `5878e5a1`, `97f14676` ("Add JWT helper functions to database for authentication")
- Companion: `keys/public.pem` (451 bytes)

### 3. Neon Postgres Database Passwords (3 generations leaked)
- `<LEAKED-NEON-PW-PRIOR-1>`
- `<LEAKED-NEON-PW-CURRENT>`
- `<LEAKED-NEON-PW-PRIOR-2>`
- Full connection: `postgresql://neondb_owner:<LEAKED-NEON-PW-CURRENT>@ep-rough-bonus-...c-2.us-west-2.aws.neon.tech/neondb`
- Introducing commits include `d366d738`, `9f276058`, `f904ab5f`

### 4. Neon API Token
- Token: `<LEAKED-NEON-API-TOKEN>...`
- Introduced in `e5ad0cf3` ("Saved progress at the end of the loop") via curl Authorization Bearer header
- Date: Sat Nov 29 09:59:44 2025

### 5. client_secret / OAuth credentials
- Found in commit `413d94c4` (Fri Feb 13 21:14:20 2026)  content needs further review

### 6. Reference to "Uber secrets"
- Commit `37bb1714` "Add Uber OAuth and webhook integration"  needs review for leaked Uber API keys

## Confirmed CLEAN (no real keys leaked)
- OpenAI API keys (`sk-proj-`, `sk-...`)  0 hits
- Anthropic API keys (`sk-ant-`)  0 hits
- Perplexity (`pplx-`)  0 hits
- Groq (`gsk_`)  0 hits
- AWS access keys (`AKIA...`)  0 hits
- GitHub PATs (`ghp_`, `gho_`)  0 hits
- Files like `.env.unified` use `${VAR}` interpolation  placeholders, not real secrets
- `.env.example` and `.env.local.example` in current tree contain only placeholder values

## Repo Stats
- 4605 commits in history
- Current branch: `main`
- Files like `private.pem`, `.env.unified`, `env/*.env`, `mono-mode.env` all appear in deletion history (committed then removed but still reachable)

## Working Tree (current HEAD)  credential-adjacent files tracked
- `.env.example`
- `.env.local.example`
- `keys/private.pem`   STILL PRESENT, MATCHES LEAKED HASH
- `keys/public.pem`
- (.config/.semgrep/semgrep_rules.json, etc.  non-secret config)

## Required Actions (in order)

### IMMEDIATE (before anything else)
1. **In Google Cloud Console:** Disable / delete the leaked service-account key for `vertex-express@quantum-fusion-486920-p2.iam.gserviceaccount.com`
2. **In Google Cloud Console:** Delete the leaked Google API key `<LEAKED-GCP-KEY-A>` and create new restricted ones
3. **In Neon Console:** Rotate the database password (currently exposed: `<LEAKED-NEON-PW-CURRENT>` and previous generations)
4. **In Neon Console:** Revoke and rotate the Neon API token `<LEAKED-NEON-API-TOKEN>...`
5. **Delete `keys/private.pem` and `keys/public.pem`** from disk; regenerate a NEW JWT signing keypair; add `keys/` to `.gitignore`
6. **Review commits `413d94c4` (client_secret) and `37bb1714` (Uber)** for additional leaks; rotate those too

### SHORT TERM
7. **Make the GitHub repo PRIVATE** (Settings  Danger Zone  Change visibility)  this stops further indexing
8. **Audit GCP Cloud Logging** for the suspension period: which IPs called the API, what compute was spun up, total billing impact
9. **Submit a GCP appeal** explaining: rotated credentials, removed exposure, made repo private, committed to history scrub

### MEDIUM TERM (after rotation done)
10. **Scrub git history** with `git filter-repo` (preferred) or BFG Repo-Cleaner. Target paths:
    - `keys/private.pem`, `keys/public.pem`
    - `.env`, `.env.unified`, `.env.local`, `mono-mode.env`
    - `env/neon-resilience.env`, `env/shared.env`, `env/webservice.env`, `env/worker.env`
    - any commit with literal `<LEAKED-GCP-KEY-A>`, `<LEAKED-NEON-API-TOKEN>...`, `npg_*`
11. Force-push the rewritten history; notify any collaborators they must re-clone
12. Even after history scrub, **assume every leaked credential is permanently compromised**  GitHub events API caches commit blobs for 90+ days and Google's scanners have already seen them. Rotation is the only real fix.

### LONG TERM
13. Add a pre-commit hook (gitleaks, trufflehog) to prevent recurrence
14. Move all secrets to Replit Secrets (env vars)  never commit keypairs again
15. Set GCP API key restrictions (HTTP referrer, IP allowlist, API service restrictions)
16. Enable GCP audit logging if not already on

## Notes
- The Claude Code agent session crashed during the "Produce rotation list" thinking phase; this file captures everything it found before that. The remaining tasks (Draft Google Cloud appeal, Plan history scrub) were not completed.
- All scans run were read-only (git log, git show, git ls-tree, sha256sum, ls). Nothing was modified.
