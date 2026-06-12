import { serve } from '@hono/node-server';
import app, { nodeWebSocket } from './app';
import { config } from './config';
import { ensureNightWorkersSchema } from './db/bootstrap';
import { client } from './db/client';
import { logEvent } from './lib/logger';
import { flushActivityEventQueue } from './modules/nightworkers/nightworkers.activity.repository';
import { mcpClientManager } from './services/mcp/mcp-client-manager';
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

type ServerWithCloseAllConnections = ReturnType<typeof serve> & {
  closeAllConnections?: () => void;
};

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

function collectCleanupError(errors: Error[], scope: string, result: PromiseSettledResult<void>) {
  if (result.status === 'fulfilled') return;
  const reason = result.reason;
  const error = reason instanceof Error ? reason : new Error(String(reason));
  error.message = `${scope}: ${error.message}`;
  errors.push(error);
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

    const httpClosePromise = closeHttpServer(server);
    const forceCloseTimer = setTimeout(() => {
      logEvent({
        channel: 'api',
        level: 'error',
        message: 'graceful shutdown timed out',
        meta: { signal, timeoutMs: shutdownTimeoutMs },
      });
      (server as ServerWithCloseAllConnections).closeAllConnections?.();
      nodeWebSocket.wss.clients.forEach((socket) => {
        socket.terminate();
      });
    }, shutdownTimeoutMs);
    forceCloseTimer.unref?.();

    try {
      const errors: Error[] = [];
      collectCleanupError(
        errors,
        'HTTP server close',
        await Promise.allSettled([httpClosePromise]).then(([result]) => result)
      );
      nightWorkersRealtimeBroker.closeAll();
      collectCleanupError(
        errors,
        'Activity event queue flush',
        await Promise.allSettled([flushActivityEventQueue()]).then(([result]) => result)
      );
      collectCleanupError(
        errors,
        'WebSocket server close',
        await Promise.allSettled([closeWebSocketServer()]).then(([result]) => result)
      );
      collectCleanupError(
        errors,
        'MCP client disconnect',
        await Promise.allSettled([mcpClientManager.disconnectAll()]).then(([result]) => result)
      );
      collectCleanupError(
        errors,
        'DB client close',
        await Promise.allSettled([Promise.resolve(client.close())]).then(([result]) => result)
      );
      clearTimeout(forceCloseTimer);
      if (errors.length > 0) {
        throw new AggregateError(errors, 'One or more shutdown steps failed');
      }
      logEvent({ channel: 'api', level: 'info', message: 'shutdown complete', meta: { signal } });
    } catch (error) {
      clearTimeout(forceCloseTimer);
      logEvent({
        channel: 'api',
        level: 'error',
        message: 'shutdown failed',
        meta: {
          signal,
          errorMessage: error instanceof Error ? error.message : String(error),
          errors:
            error instanceof AggregateError
              ? error.errors.map((item) => (item instanceof Error ? item.message : String(item)))
              : undefined,
        },
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
