import { serve } from '@hono/node-server';
import app, { nodeWebSocket } from './app';
import { config } from './config';
import { ensureNightWorkersSchema } from './db/bootstrap';
import { client } from './db/client';
import { logEvent } from './lib/logger';
import { nightWorkersRealtimeBroker } from './services/realtime/nightworkers-ws';

export type NightWorkersServerOptions = {
  port?: number;
  host?: string;
  shutdownTimeoutMs?: number;
};

export type NightWorkersServerHandle = {
  port: number;
  host: string;
  origin: string;
  server: ReturnType<typeof serve>;
  close: (signal?: NodeJS.Signals | 'manual') => Promise<void>;
};

const defaultShutdownTimeoutMs = 10_000;

function closeHttpServer(server: ReturnType<typeof serve>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function closeWebSocketServer() {
  return new Promise<void>((resolve, reject) => {
    nodeWebSocket.wss.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function createNightWorkersServer(
  options: NightWorkersServerOptions = {}
): Promise<NightWorkersServerHandle> {
  const port = options.port ?? config.PORT;
  const host = options.host ?? '127.0.0.1';
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? defaultShutdownTimeoutMs;

  await ensureNightWorkersSchema();

  const server = serve({
    fetch: app.fetch,
    hostname: host,
    port,
  });
  nodeWebSocket.injectWebSocket(server);

  logEvent({ channel: 'api', level: 'info', message: 'server started', meta: { host, port } });

  let closed = false;
  const close = async (signal: NodeJS.Signals | 'manual' = 'manual') => {
    if (closed) return;
    closed = true;
    logEvent({ channel: 'api', level: 'info', message: 'shutting down', meta: { signal } });

    const forceCloseTimer = setTimeout(() => {
      logEvent({
        channel: 'api',
        level: 'error',
        message: 'graceful shutdown timed out',
        meta: { signal, timeoutMs: shutdownTimeoutMs },
      });
    }, shutdownTimeoutMs);
    forceCloseTimer.unref?.();

    try {
      nightWorkersRealtimeBroker.closeAll();
      await closeWebSocketServer();
      await closeHttpServer(server);
      await Promise.resolve(client.close());
      clearTimeout(forceCloseTimer);
      logEvent({ channel: 'api', level: 'info', message: 'shutdown complete', meta: { signal } });
    } catch (error) {
      clearTimeout(forceCloseTimer);
      logEvent({
        channel: 'api',
        level: 'error',
        message: 'shutdown failed',
        meta: { signal, errorMessage: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  };

  return {
    port,
    host,
    origin: `http://${host}:${port}`,
    server,
    close,
  };
}
