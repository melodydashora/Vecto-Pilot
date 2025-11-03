import pg from 'pg';

let pgClient = null;

export async function getListenClient() {
  if (pgClient && pgClient._connected) {
    return pgClient;
  }

  pgClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    application_name: 'triad-listener',
  });

  try {
    await pgClient.connect();
    console.log('[db-client] LISTEN client connected');
    
    // Subscribe to strategy_ready channel
    await pgClient.query('LISTEN strategy_ready');
    console.log('[db-client] Subscribed to strategy_ready channel');
    
    pgClient.on('error', (err) => {
      console.error('[db-client] Unexpected pg client error:', err);
      pgClient = null;
    });

    pgClient.on('end', () => {
      console.warn('[db-client] pg client connection ended');
      pgClient = null;
    });

    pgClient.on('notification', (msg) => {
      console.log('[db-client] Received notification:', msg.channel, msg.payload);
    });

    return pgClient;
  } catch (err) {
    console.error('[db-client] Failed to connect LISTEN client:', err);
    pgClient = null;
    throw err;
  }
}

export async function closeListenClient() {
  if (pgClient) {
    await pgClient.end();
    pgClient = null;
    console.log('[db-client] LISTEN client closed');
  }
}
