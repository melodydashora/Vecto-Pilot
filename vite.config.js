import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

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
    root: path.resolve(projectRoot, "client"),
    plugins: [
      react(),
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
  };
});