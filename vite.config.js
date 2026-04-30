import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import * as path from "path";

// 2026-04-05: Plugin to strip React DevTools script tag from production builds
function stripDevToolsPlugin() {
  return {
    name: 'strip-react-devtools',
    transformIndexHtml(html, ctx) {
      // Only strip in production builds; keep during dev
      if (ctx.server) return html; // dev server — keep as-is
      // Remove the React DevTools script block (comment + script tag)
      return html.replace(
        /\s*<!-- React DevTools standalone connector.*?<\/script>/s,
        ''
      );
    },
  };
}

export default defineConfig(async () => {
  let runtimeErrorOverlay;
  try {
    const mod = await import("@replit/vite-plugin-runtime-error-modal");
    runtimeErrorOverlay = mod.default || mod;
  } catch (error) {
    runtimeErrorOverlay = null;
  }

  const projectRoot = process.cwd();

  return {
    base: '/',
    root: path.resolve(projectRoot, "client"),
    // 2026-04-27: Read .env files from project root (where VITE_MCP_REPLIT_TOKEN
    // and other VITE_* vars already live in `.env`). Without this override,
    // envDir would default to `root` (= client/), which has no .env files,
    // silently dropping every VITE_* var defined in `.env.local`. Surfaced when
    // VITE_COACH_STREAMING_TTS=true was added to project-root `.env.local` and
    // the rebuilt bundle still acted as if the flag were false because Vite
    // was looking under client/ for env files and finding none.
    envDir: projectRoot,
    plugins: [
      react(),
      stripDevToolsPlugin(),
      ...(runtimeErrorOverlay ? [runtimeErrorOverlay()] : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(projectRoot, "client", "src"),
        "@shared": path.resolve(projectRoot, "shared"),
        "@assets": path.resolve(projectRoot, "client", "src", "assets"),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      host: '0.0.0.0',
    },
    build: {
      outDir: path.resolve(projectRoot, "client", "dist"),
      emptyOutDir: true,
      sourcemap: false,
      // Increase warning limit - heavy deps like Charts/Maps are expected
      chunkSizeWarningLimit: 1200, // Main chunk ~1.12MB due to React+charts in same chunk
      // 2026-01-05: Feature-based code splitting for optimal caching
      rollupOptions: {
        output: {
          // 2026-01-05: Conservative chunking to avoid React dependency issues
          // Only split packages that are truly independent (no React deps)
          manualChunks(id) {
            if (id.includes('node_modules')) {
              // UI components - independent from each other
              if (id.includes('@radix-ui') || id.includes('lucide-react')) {
                return 'vendor-ui';
              }
              // CSS utilities - no dependencies
              if (id.includes('tailwind-merge') || id.includes('class-variance-authority') || id.includes('clsx')) {
                return 'vendor-css';
              }
              // Charts - separate chunk
              if (id.includes('recharts')) {
                return 'vendor-charts';
              }
              // Let Rollup handle React, charts, and everything else naturally
              // This prevents forwardRef errors from chunk load ordering issues
            }
          }
        }
      }
    },
  };
});