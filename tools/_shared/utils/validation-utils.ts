// ============================================================================
// VALIDATION UTILITIES - Input validation helpers
// ============================================================================

import * as fs from 'fs';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate that required fields are present
 */
export function validateRequired(
  args: Record<string, unknown>,
  requiredFields: string[]
): ValidationResult {
  const errors: string[] = [];

  for (const field of requiredFields) {
    if (args[field] === undefined || args[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate that a value is of a specific type
 */
export function validateType(
  value: unknown,
  expectedType: 'string' | 'number' | 'boolean' | 'object' | 'array',
  fieldName: string
): ValidationResult {
  const errors: string[] = [];
  const actualType = Array.isArray(value) ? 'array' : typeof value;

  if (actualType !== expectedType) {
    errors.push(`${fieldName} must be of type ${expectedType}, got ${actualType}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate that a string is not empty
 */
export function validateNotEmpty(
  value: unknown,
  fieldName: string
): ValidationResult {
  const errors: string[] = [];

  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${fieldName} must be a non-empty string`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate that a path exists
 */
export function validatePathExists(
  targetPath: string,
  options: { mustBeFile?: boolean; mustBeDir?: boolean } = {}
): ValidationResult {
  const errors: string[] = [];

  if (!fs.existsSync(targetPath)) {
    errors.push(`Path does not exist: ${targetPath}`);
    return { valid: false, errors };
  }

  const stat = fs.statSync(targetPath);

  if (options.mustBeFile && !stat.isFile()) {
    errors.push(`Path is not a file: ${targetPath}`);
  }

  if (options.mustBeDir && !stat.isDirectory()) {
    errors.push(`Path is not a directory: ${targetPath}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate that a string is a valid file path
 */
export function validateFilePath(filePath: string): ValidationResult {
  const errors: string[] = [];

  if (typeof filePath !== 'string') {
    errors.push('File path must be a string');
    return { valid: false, errors };
  }

  if (filePath.trim().length === 0) {
    errors.push('File path cannot be empty');
  }

  // Check for invalid characters (platform-specific)
  const invalidChars = process.platform === 'win32'
    ? /[<>:"|?*]/
    : /\0/;

  if (invalidChars.test(filePath)) {
    errors.push('File path contains invalid characters');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate that a string is one of allowed values
 */
export function validateEnum(
  value: unknown,
  allowedValues: string[],
  fieldName: string
): ValidationResult {
  const errors: string[] = [];

  if (typeof value !== 'string') {
    errors.push(`${fieldName} must be a string`);
    return { valid: false, errors };
  }

  if (!allowedValues.includes(value)) {
    errors.push(`${fieldName} must be one of: ${allowedValues.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate that a number is within a range
 */
export function validateRange(
  value: unknown,
  min: number,
  max: number,
  fieldName: string
): ValidationResult {
  const errors: string[] = [];

  if (typeof value !== 'number') {
    errors.push(`${fieldName} must be a number`);
    return { valid: false, errors };
  }

  if (value < min || value > max) {
    errors.push(`${fieldName} must be between ${min} and ${max}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Combine multiple validation results
 */
export function combineResults(...results: ValidationResult[]): ValidationResult {
  const allErrors = results.flatMap(r => r.errors);
  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}

/**
 * Sanitize a string for safe use in file names
 */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_.]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Sanitize a string for safe use in shell commands
 */
export function sanitizeShellArg(arg: string): string {
  // Escape single quotes and backslashes
  return arg.replace(/['\\]/g, '\\$&');
}

/**
 * Validate and parse JSON string
 */
export function parseJson<T = unknown>(jsonString: string): { valid: boolean; data?: T; error?: string } {
  try {
    const data = JSON.parse(jsonString) as T;
    return { valid: true, data };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid JSON',
    };
  }
}

/**
 * Validate tool arguments against a schema
 */
export function validateToolArgs(
  args: unknown,
  schema: {
    required?: string[];
    properties?: Record<string, { type: string; enum?: string[] }>;
  }
): ValidationResult {
  const errors: string[] = [];

  if (typeof args !== 'object' || args === null) {
    return { valid: false, errors: ['Arguments must be an object'] };
  }

  const argsObj = args as Record<string, unknown>;

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (argsObj[field] === undefined || argsObj[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  // Check property types
  if (schema.properties) {
    for (const [field, propSchema] of Object.entries(schema.properties)) {
      const value = argsObj[field];
      if (value === undefined) continue;

      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== propSchema.type) {
        errors.push(`${field} must be of type ${propSchema.type}, got ${actualType}`);
      }

      if (propSchema.enum && !propSchema.enum.includes(value as string)) {
        errors.push(`${field} must be one of: ${propSchema.enum.join(', ')}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}