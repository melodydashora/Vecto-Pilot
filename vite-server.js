// vite-server.js - Robust Vite development server with error handling and monitoring

import { createServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.VITE_PORT) || 3002;
const HOST = '0.0.0.0';

let viteServer = null;
let isShuttingDown = false;

async function startViteServer() {
  try {
    console.log(`[vite] Starting Vite dev server on ${HOST}:${PORT}...`);
    
    viteServer = await createServer({
      configFile: path.resolve(__dirname, 'vite.config.js'),
      server: {
        host: HOST,
        port: PORT,
        strictPort: true,
        hmr: {
          protocol: 'ws',
          host: HOST,
          port: PORT,
          clientPort: PORT,
        },
      },
      logLevel: 'info',
    });

    await viteServer.listen();

    console.log(`✅ [vite] Dev server ready on http://${HOST}:${PORT}`);
    console.log(`✅ [vite] HMR WebSocket: ws://${HOST}:${PORT}`);
    
    viteServer.printUrls();

    // Handle Vite server errors
    viteServer.httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ [vite] Port ${PORT} already in use`);
        process.exit(1);
      } else {
        console.error(`❌ [vite] Server error:`, err);
      }
    });

    // Monitor for unexpected closures
    viteServer.httpServer.on('close', () => {
      if (!isShuttingDown) {
        console.warn(`⚠️ [vite] Server closed unexpectedly`);
      }
    });

  } catch (err) {
    console.error(`❌ [vite] Failed to start server:`, err);
    process.exit(1);
  }
}

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('[vite] Shutting down gracefully...');
  
  try {
    if (viteServer) {
      await viteServer.close();
      console.log('[vite] Server closed successfully');
    }
  } catch (err) {
    console.error('[vite] Error during shutdown:', err);
  }
  
  process.exit(0);
}

// Graceful shutdown handlers
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('[vite] Uncaught exception:', err);
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[vite] Unhandled rejection at:', promise, 'reason:', reason);
  shutdown();
});

// Start the server
startViteServer();
