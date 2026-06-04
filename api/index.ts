import { serve } from '@hono/node-server';
import app, { nodeWebSocket } from './app';
import { config } from './config';
import { ensureNightWorkersSchema } from './db/bootstrap';
import { client } from './db/client';
import { logEvent } from './lib/logger';
import { nightWorkersRealtimeBroker } from './services/realtime/nightworkers-ws';

const port = config.PORT;
const shutdownTimeoutMs = 10_000;

await ensureNightWorkersSchema();

const server = serve({
  fetch: app.fetch,
  port,
});
nodeWebSocket.injectWebSocket(server);

logEvent({ channel: 'api', level: 'info', message: 'server started', meta: { port } });

let shuttingDown = false;

const closeHttpServer = () =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const closeWebSocketServer = () =>
  new Promise<void>((resolve, reject) => {
    nodeWebSocket.wss.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;

  logEvent({ channel: 'api', level: 'info', message: 'shutting down', meta: { signal } });

  const forceExitTimer = setTimeout(() => {
    logEvent({
      channel: 'api',
      level: 'error',
      message: 'graceful shutdown timed out',
      meta: { signal, timeoutMs: shutdownTimeoutMs },
    });
    process.exit(1);
  }, shutdownTimeoutMs);
  forceExitTimer.unref?.();

  try {
    nightWorkersRealtimeBroker.closeAll();
    await closeWebSocketServer();
    await closeHttpServer();
    await Promise.resolve(client.close());
    clearTimeout(forceExitTimer);
    logEvent({ channel: 'api', level: 'info', message: 'shutdown complete', meta: { signal } });
    process.exit(0);
  } catch (error) {
    clearTimeout(forceExitTimer);
    logEvent({
      channel: 'api',
      level: 'error',
      message: 'shutdown failed',
      meta: { signal, errorMessage: error instanceof Error ? error.message : String(error) },
    });
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
