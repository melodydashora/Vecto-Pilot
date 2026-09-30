import { parse } from 'pg-connection-string';

/**
 * DATABASE_URL is the sole database selector. Parse it once so pg cannot later
 * replace our SSL settings with URL parameters. Keep supplied certificate/key/
 * CA material; remote connections always verify the certificate and hostname.
 */
export function databaseConnectionConfig(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  let config;
  try {
    const url = new URL(connectionString);
    if (!['postgres:', 'postgresql:', 'socket:'].includes(url.protocol)) throw new Error('protocol');
    config = parse(connectionString);
    if (!config.host || !config.database) throw new Error('target');
  } catch {
    // Parser/URL errors can otherwise include a credential-bearing input or a
    // private certificate path. Do not attach that original error as a cause.
    throw new Error('DATABASE_URL configuration is invalid or its TLS files are unavailable');
  }
  const host = config.host.toLowerCase();
  const local = ['localhost', '127.0.0.1', '::1', '[::1]', 'helium'].includes(host) || host.startsWith('/');
  if (local && (config.ssl === undefined || config.ssl === false)) {
    config.ssl = false;
  } else {
    config.ssl = { ...(typeof config.ssl === 'object' ? config.ssl : {}), rejectUnauthorized: true };
    // libpq compatibility's verify-ca mode skips hostname checks. This runtime
    // requires both identity checks, including when a private CA is supplied.
    delete config.ssl.checkServerIdentity;
  }
  // These were consumed by the parser. Passing connectionString again would
  // reparse them and could silently disable the verification above.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) delete config[key];
  return config;
}
