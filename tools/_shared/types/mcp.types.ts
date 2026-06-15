// ============================================================================
// MCP TYPES - Common types for all MCP tools
// ============================================================================

/**
 * Standard tool definition for MCP servers
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, SchemaProperty>;
    required?: string[];
  };
}

/**
 * Schema property definition
 */
export interface SchemaProperty {
  type: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
}

/**
 * MCP tool handler result
 * Compatible with @modelcontextprotocol/sdk
 */
export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Tool content item
 */
export interface ToolContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

/**
 * Server configuration
 */
export interface ServerConfig {
  name: string;
  version: string;
  capabilities?: Record<string, unknown>;
}

/**
 * Tool handler function type
 */
export type ToolHandler = (args: unknown) => Promise<ToolResult>;