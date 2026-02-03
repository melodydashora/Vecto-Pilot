
/**
 * Centralized Port Configuration
 * Single source of truth for all port assignments
 * 
 * MONO Mode: All services embedded in gateway on PORT
 * SPLIT Mode: Each service on separate port
 */

export const PORTS = {
  // Main gateway port (HTTP + WebSocket)
  GATEWAY: parseInt(process.env.PORT || process.env.GATEWAY_PORT || '5000', 10),
  
  // Eidolon SDK port (SPLIT mode only)
  SDK: parseInt(process.env.SDK_PORT || process.env.EIDOLON_PORT || '3102', 10),
  
  // Agent port (SPLIT mode only)
  AGENT: parseInt(process.env.AGENT_PORT || '43717', 10),
  
  // Vite dev server
  VITE: parseInt(process.env.VITE_PORT || '5173', 10),
  
  // PostgreSQL
  POSTGRES: parseInt(process.env.PGPORT || '5432', 10)
};

export const MODE = (process.env.APP_MODE || 'mono').toLowerCase();

export const BASE_URL = process.env.BASE_URL || 
  `http://${process.env.REPLIT_DEV_DOMAIN || `localhost:${PORTS.GATEWAY}`}`;

// Helper to get port based on mode
export function getPort(service) {
  if (MODE === 'mono') {
    return PORTS.GATEWAY; // All services on gateway port in mono mode
  }
  return PORTS[service.toUpperCase()] || PORTS.GATEWAY;
}

// Helper to check if service should run in separate process
export function shouldSpawnSeparately(service) {
  return MODE === 'split' && !process.env[`DISABLE_SPAWN_${service.toUpperCase()}`];
}

export default {
  PORTS,
  MODE,
  BASE_URL,
  getPort,
  shouldSpawnSeparately
};
