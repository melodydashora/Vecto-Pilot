
Replit restore guide for Vecto Pilot

1) Create a new Node.js Repl.
2) Upload vecto-pilot-clean.tar.gz to the project root.
3) Open the Shell tab and run:
   tar -xzf vecto-pilot-clean.tar.gz --strip-components=1
   npm install

4) Open the "Secrets" panel and add at minimum:
   ANTHROPIC_API_KEY=...
   OPENAI_API_KEY=...
   GOOGLE_API_KEY=...
   GEMINI_API_KEY=...       # if separate from GOOGLE_API_KEY in your setup
   EIDOLON_TOKEN=$(openssl rand -hex 32)
   AGENT_TOKEN=$(openssl rand -hex 32)
   ASSISTANT_OVERRIDE_TOKEN=$(openssl rand -hex 32)
   GW_KEY=$(openssl rand -hex 32)

   Optional but recommended:
   PERPLEXITY_API_KEY=...
   REDIS_URL=...            # if you use external redis
   POSTGRES_URL=...         # if you use external postgres

5) Press "Run" (or run npm run dev in the Shell). Replit will expose PORT automatically.
   The server listens on process.env.PORT and will print a preview URL like:
   https://<slug>.<owner>.repl.co

6) Health checks:
   GET /health      # gateway
   GET /agent/health
   GET /api/assistant/health

7) Common fixes:
   - If build fails on first run, try: rm -rf node_modules && npm ci
   - If TypeScript path issues arise, run: npx tsc --noEmit to surface errors
   - If Vite client dev server conflicts, let gateway handle static client build: npm run build

8) Production note:
   When NODE_ENV=production, the gateway runs build automatically; use npm run start to mimic.
