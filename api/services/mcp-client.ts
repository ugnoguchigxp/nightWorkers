import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

class McpClientService {
  private client: Client | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: transport can be StdioClientTransport or SSEClientTransport
  private transport: any = null;

  async connect() {
    if (this.client) return;

    this.client = new Client(
      {
        name: 'nightworkers-control-plane',
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
    } catch (err) {
      console.error('Failed to connect to contextStill MCP Server:', err);
      // Fallback: allow the application to run without throwing, but log the error
      this.client = null;
    }
  }

  async contextCompile(
    repositoryPath: string,
    taskTitle: string,
    taskDescription?: string
  ): Promise<unknown> {
    try {
      await this.connect();
      if (!this.client) {
        console.warn('MCP connection not established, bypassing context_compile.');
        return {
          content: [
            {
              type: 'text',
              text: `[Bypassed context compile] Task: ${taskTitle}\nDescription: ${taskDescription || ''}`,
            },
          ],
        };
      }

      const result = await this.client.callTool({
        name: 'context_compile',
        arguments: {
          repository_path: repositoryPath,
          task_title: taskTitle,
          task_description: taskDescription || '',
        },
      });

      return result;
    } catch (err) {
      console.error('Error during context_compile:', err);
      return {
        content: [
          {
            type: 'text',
            text: `[Error compiling context: ${(err as Error).message}] Task: ${taskTitle}`,
          },
        ],
      };
    }
  }

  async compileEval(
    runId: string,
    resultSummary: string,
    wasSuccessful: boolean
  ): Promise<unknown> {
    try {
      await this.connect();
      if (!this.client) {
        console.warn('MCP connection not established, bypassing compile_eval.');
        return null;
      }

      return await this.client.callTool({
        name: 'compile_eval',
        arguments: {
          run_id: runId,
          result_summary: resultSummary,
          was_successful: wasSuccessful,
        },
      });
    } catch (err) {
      console.error('Error during compile_eval:', err);
      return null;
    }
  }

  async registerCandidate(topic: string, content: string, sourceRunId: string): Promise<unknown> {
    try {
      await this.connect();
      if (!this.client) {
        console.warn('MCP connection not established, bypassing register_candidate.');
        return null;
      }

      return await this.client.callTool({
        name: 'register_candidate',
        arguments: {
          topic,
          content,
          source_run_id: sourceRunId,
        },
      });
    } catch (err) {
      console.error('Error during register_candidate:', err);
      return null;
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

export const mcpClientService = new McpClientService();
