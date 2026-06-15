// ============================================================================
// MCP SERVER BASE - Abstract base class for all MCP servers
// ============================================================================

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from './ToolRegistry.js';
import type { ServerConfig, ToolDefinition, ToolHandler, ToolResult } from '../types/mcp.types.js';

/**
 * Abstract base class for MCP servers.
 * Eliminates boilerplate by handling:
 * - Server setup and configuration
 * - Tool registration
 * - Request handlers (ListTools, CallTool)
 * - Error handling
 * - SIGINT cleanup
 *
 * @example
 * ```typescript
 * class MyToolServer extends McpServerBase {
 *   constructor() {
 *     super({ name: 'my-tool', version: '1.0.0' });
 *   }
 *
 *   protected registerTools(): void {
 *     this.addTool('my_action', 'Does something', { ... }, this.handleMyAction.bind(this));
 *   }
 *
 *   private async handleMyAction(args: unknown): Promise<ToolResult> {
 *     // Tool-specific logic
 *     return this.success({ result: 'done' });
 *   }
 * }
 *
 * new MyToolServer().run();
 * ```
 */
export abstract class McpServerBase {
  protected server: Server;
  protected registry: ToolRegistry;
  protected config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
    this.registry = new ToolRegistry();

    this.server = new Server(
      { name: config.name, version: config.version },
      { capabilities: { tools: {} } }
    );

    this.setupHandlers();
    this.setupErrorHandlers();

    // Allow subclasses to register their tools
    this.registerTools();
  }

  /**
   * Subclasses must implement this to register their tools.
   * Use `this.addTool()` to register each tool.
   */
  protected abstract registerTools(): void;

  /**
   * Register a tool with the server
   */
  protected addTool(
    name: string,
    description: string,
    inputSchema: ToolDefinition['inputSchema'],
    handler: ToolHandler
  ): void {
    this.registry.register(name, description, inputSchema, handler);
  }

  /**
   * Set up ListTools and CallTool request handlers
   */
  private setupHandlers(): void {
    // ListTools handler
    this.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: this.registry.getAllDefinitions(),
    }));

    // CallTool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const handler = this.registry.getHandler(name);
      if (!handler) {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }

      try {
        return await handler(args);
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${message}`);
      }
    });
  }

  /**
   * Set up error handlers
   */
  private setupErrorHandlers(): void {
    this.server.onerror = (error) => {
      console.error(`[${this.config.name}] MCP Error:`, error);
    };

    process.on('SIGINT', () => {
      void this.shutdown();
    });
  }

  /**
   * Create a success response
   */
  protected success<T extends Record<string, unknown>>(data: T): ToolResult {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, ...data }, null, 2),
        },
      ],
    };
  }

  /**
   * Create an error response
   */
  protected error(error: unknown): ToolResult {
    const errorObj = this.formatError(error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: false, error: errorObj }, null, 2),
        },
      ],
      isError: true,
    };
  }

  /**
   * Format an error for the response
   */
  private formatError(error: unknown): {
    code: string;
    message: string;
    suggestion?: string;
    timestamp: string;
  } {
    if (error instanceof McpError) {
      return {
        code: String(error.code),
        message: error.message,
        timestamp: new Date().toISOString(),
      };
    }

    if (error instanceof Error) {
      return {
        code: error.constructor.name || 'Error',
        message: error.message,
        suggestion: this.getSuggestion(error),
        timestamp: new Date().toISOString(),
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: String(error),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get helpful suggestions for common errors
   */
  private getSuggestion(error: Error): string | undefined {
    const msg = error.message.toLowerCase();

    if (msg.includes('enoent') || msg.includes('no such file')) {
      return 'Ensure the file or directory exists and the path is correct.';
    }
    if (msg.includes('eacces') || msg.includes('permission denied')) {
      return 'Check file permissions or run with appropriate privileges.';
    }
    if (msg.includes('eexist') || msg.includes('already exists')) {
      return 'The resource already exists. Use a different name or delete the existing one.';
    }

    return undefined;
  }

  /**
   * Start the server
   */
  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`${this.config.name} MCP server v${this.config.version} running on stdio`);
  }

  /**
   * Gracefully shutdown the server
   */
  async shutdown(): Promise<void> {
    await this.server.close();
    process.exit(0);
  }
}