import { serve } from '@hono/node-server';
import app from './app';
import { config } from './config';
import { client } from './db/client';
import { logger } from './lib/logger';

const port = config.PORT;

const server = serve({
  fetch: app.fetch,
  port,
});

logger.info(`🚀 Server running on port ${port}`);

// Graceful Shutdown
const shutdown = async () => {
  logger.info('Shutting down...');
  server.close();
  client.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
