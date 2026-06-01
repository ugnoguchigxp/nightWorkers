import { serve } from '@hono/node-server';
import app, { nodeWebSocket } from './app';
import { config } from './config';
import { ensureNightWorkersSchema } from './db/bootstrap';
import { client } from './db/client';
import { logEvent } from './lib/logger';

const port = config.PORT;

await ensureNightWorkersSchema();

const server = serve({
  fetch: app.fetch,
  port,
});
nodeWebSocket.injectWebSocket(server);

logEvent({ channel: 'api', level: 'info', message: 'server started', meta: { port } });

// Graceful Shutdown
const shutdown = async () => {
  logEvent({ channel: 'api', level: 'info', message: 'shutting down' });
  server.close();
  client.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
