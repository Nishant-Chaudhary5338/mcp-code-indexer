// ============================================================================
// RESPONSE TYPES - Standardized response formats
// ============================================================================

/**
 * Standard success response wrapper
 */
export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
  metadata?: ResponseMetadata;
}

/**
 * Standard error response wrapper
 */
export interface ErrorResponse {
  success: false;
  error: ErrorDetails;
  metadata?: ResponseMetadata;
}

/**
 * Error details
 */
export interface ErrorDetails {
  code: string;
  message: string;
  suggestion?: string;
  timestamp: string;
  path?: string;
}

/**
 * Response metadata
 */
export interface ResponseMetadata {
  timestamp: string;
  duration?: number;
  version?: string;
}

/**
 * Union type for all responses
 */
export type ApiResponse<T = unknown> = SuccessResponse<T> | ErrorResponse;

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Analysis result base
 */
export interface AnalysisResult {
  tool: string;
  toolPath: string;
  overallScore: number;
  maxScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  totalIssues: number;
}

/**
 * File operation result
 */
export interface FileOperationResult {
  success: boolean;
  path: string;
  message?: string;
  error?: string;
}

/**
 * Batch operation result
 */
export interface BatchResult<T> {
  total: number;
  succeeded: number;
  failed: number;
  results: T[];
  errors?: string[];
}