// ============================================================================
// ERROR TYPES - Error handling types
// ============================================================================

/**
 * Error severity levels
 */
export type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Error categories
 */
export type ErrorCategory =
  | 'validation'
  | 'file_system'
  | 'network'
  | 'compilation'
  | 'runtime'
  | 'configuration'
  | 'permission'
  | 'unknown';

/**
 * Structured error with context
 */
export interface StructuredError {
  code: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  suggestion?: string;
  context?: Record<string, unknown>;
  timestamp: string;
  stack?: string;
}

/**
 * Validation error
 */
export interface ValidationError extends StructuredError {
  category: 'validation';
  field?: string;
  expected?: string;
  received?: string;
}

/**
 * File system error
 */
export interface FileSystemError extends StructuredError {
  category: 'file_system';
  path?: string;
  operation?: 'read' | 'write' | 'delete' | 'create' | 'rename';
}

/**
 * Compilation error
 */
export interface CompilationError extends StructuredError {
  category: 'compilation';
  file?: string;
  line?: number;
  column?: number;
}

/**
 * Error handler function type
 */
export type ErrorHandler = (error: Error | StructuredError) => void;

/**
 * Error codes enum
 */
export const ErrorCodes = {
  // Validation errors
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED: 'MISSING_REQUIRED',
  INVALID_TYPE: 'INVALID_TYPE',
  INVALID_FORMAT: 'INVALID_FORMAT',

  // File system errors
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_EXISTS: 'FILE_EXISTS',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  IO_ERROR: 'IO_ERROR',

  // Runtime errors
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
  HANDLER_ERROR: 'HANDLER_ERROR',
  TIMEOUT: 'TIMEOUT',

  // Configuration errors
  CONFIG_MISSING: 'CONFIG_MISSING',
  CONFIG_INVALID: 'CONFIG_INVALID',

  // Unknown
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];