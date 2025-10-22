
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const projectRoot = process.cwd();

export default defineConfig({
    plugins: [
        react(),
        runtimeErrorOverlay(),
    ],
    resolve: {
        alias: {
            "@": path.resolve(projectRoot, "client", "src"),
            "@shared": path.resolve(projectRoot, "shared"),
            "@assets": path.resolve(projectRoot, "attached_assets"),
        },
    },
    root: path.resolve(projectRoot, "client"),
    build: {
        outDir: path.resolve(projectRoot, "dist"),
        emptyOutDir: true,
    },
    server: {
        port: 5173,
        host: "0.0.0.0",
        allowedHosts: true,
        fs: {
            strict: false,
            allow: [".."],
            deny: [],
        },
    },
});
