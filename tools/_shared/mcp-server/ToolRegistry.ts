// ============================================================================
// TOOL REGISTRY - Tool registration and lookup helper
// ============================================================================

import type { ToolDefinition, ToolHandler } from '../types/mcp.types.js';

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

/**
 * Registry for managing MCP tools
 */
export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  /**
   * Register a new tool
   */
  register(
    name: string,
    description: string,
    inputSchema: ToolDefinition['inputSchema'],
    handler: ToolHandler
  ): void {
    if (this.tools.has(name)) {
      throw new Error(`Tool already registered: ${name}`);
    }

    this.tools.set(name, {
      definition: {
        name,
        description,
        inputSchema,
      },
      handler,
    });
  }

  /**
   * Get a tool definition by name
   */
  getDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition;
  }

  /**
   * Get a tool handler by name
   */
  getHandler(name: string): ToolHandler | undefined {
    return this.tools.get(name)?.handler;
  }

  /**
   * Check if a tool is registered
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all tool definitions (for ListTools handler)
   */
  getAllDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /**
   * Get all registered tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get the number of registered tools
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.tools.clear();
  }
}