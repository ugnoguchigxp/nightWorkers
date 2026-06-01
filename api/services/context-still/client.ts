import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

class ContextStillClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | SSEClientTransport | null = null;
  private connectFailedAt: number | null = null;
  private readonly retryBackoffMs = 30_000;

  isEnabled() {
    return process.env.CONTEXT_STILL_ENABLED?.toLowerCase() === 'true';
  }

  async connect() {
    if (!this.isEnabled()) return null;
    if (this.client) return this.client;
    if (this.connectFailedAt && Date.now() - this.connectFailedAt < this.retryBackoffMs) {
      return null;
    }

    this.client = new Client(
      {
        name: 'nightworkers-context-still-client',
        version: '0.1.0',
      },
      {
        capabilities: {},
      }
    );

    const transportType = process.env.CONTEXT_STILL_TRANSPORT || 'sse';

    if (transportType === 'sse') {
      const url = process.env.CONTEXT_STILL_SSE_URL || 'http://localhost:3010/sse';
      this.transport = new SSEClientTransport(new URL(url));
    } else {
      const command = process.env.CONTEXT_STILL_COMMAND || 'npx';
      const args = process.env.CONTEXT_STILL_ARGS
        ? process.env.CONTEXT_STILL_ARGS.split(' ')
        : ['context-still'];
      this.transport = new StdioClientTransport({
        command,
        args,
      });
    }

    try {
      await this.client.connect(this.transport);
      console.log('Successfully connected to contextStill MCP Server');
      this.connectFailedAt = null;
      return this.client;
    } catch (_err) {
      console.warn(
        'contextStill MCP connection skipped (server unavailable). Set CONTEXT_STILL_ENABLED=true and start contextStill when needed.'
      );
      this.connectFailedAt = Date.now();
      this.client = null;
      this.transport = null;
      return null;
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      const clientInstance = await this.connect();
      if (!clientInstance) {
        throw new Error('MCP connection is not established.');
      }
      return await clientInstance.callTool({
        name,
        arguments: args,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`contextStill tool call skipped: ${name}. Reason: ${message}`);
      throw err;
    }
  }

  async disconnect() {
    if (this.transport) {
      try {
        await this.transport.close();
      } catch (err) {
        console.error('Error disconnecting MCP transport:', err);
      }
    }
    this.client = null;
    this.transport = null;
  }
}

export const contextStillClient = new ContextStillClient();
