/**
 * Custom error classes for the Deep Research Agent
 * Provides structured error handling with error codes and HTTP status mapping
 */

/**
 * Base application error with code and status
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: string = "INTERNAL_ERROR",
    statusCode: number = 500,
    isOperational: boolean = true,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    // Maintains proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Resource not found (HTTP 404)
 */
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const message = id
      ? `${resource} with id "${id}" not found`
      : `${resource} not found`;
    super(message, "NOT_FOUND", 404);
  }
}

/**
 * Validation error for invalid input (HTTP 400)
 */
export class ValidationError extends AppError {
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(message, "VALIDATION_ERROR", 400);
    this.field = field;
  }
}

/**
 * Duplicate resource error (HTTP 409)
 */
export class ConflictError extends AppError {
  constructor(resource: string, identifier: string) {
    super(`${resource} "${identifier}" already exists`, "CONFLICT", 409);
  }
}

/**
 * Authentication required (HTTP 401)
 */
export class AuthenticationError extends AppError {
  constructor(message: string = "Authentication required") {
    super(message, "UNAUTHORIZED", 401);
  }
}

/**
 * Insufficient permissions (HTTP 403)
 */
export class ForbiddenError extends AppError {
  constructor(message: string = "Insufficient permissions") {
    super(message, "FORBIDDEN", 403);
  }
}

/**
 * External service error (HTTP 502)
 */
export class ExternalServiceError extends AppError {
  public readonly service: string;

  constructor(service: string, message: string) {
    super(`${service}: ${message}`, "EXTERNAL_SERVICE_ERROR", 502);
    this.service = service;
  }
}

/**
 * Agent execution error
 */
export class AgentError extends AppError {
  public readonly topic: string;
  public readonly iteration: number;

  constructor(topic: string, message: string, iteration: number = 0) {
    super(
      `Agent error for "${topic}" (iteration ${iteration}): ${message}`,
      "AGENT_ERROR",
      500,
    );
    this.topic = topic;
    this.iteration = iteration;
  }
}

/**
 * Database operation error
 */
export class DatabaseError extends AppError {
  constructor(operation: string, message: string) {
    super(`Database ${operation} failed: ${message}`, "DATABASE_ERROR", 500);
  }
}

/**
 * Format an error for API response (strips sensitive info)
 */
export function formatErrorResponse(error: unknown): {
  success: false;
  error: string;
  code?: string;
  timestamp: string;
} {
  if (error instanceof AppError) {
    return {
      success: false,
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString(),
    };
  }

  if (error instanceof Error) {
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    success: false,
    error: "An unexpected error occurred",
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get HTTP status code from error
 */
export function getErrorStatusCode(error: unknown): number {
  if (error instanceof AppError) {
    return error.statusCode;
  }
  return 500;
}

/**
 * Sanitize error for logging (remove API keys, tokens)
 */
export function sanitizeErrorForLog(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/sk-[a-zA-Z0-9_-]+/g, "sk-***")
    .replace(/tvly-[a-zA-Z0-9_-]+/g, "tvly-***")
    .replace(/Bearer [a-zA-Z0-9._-]+/g, "Bearer ***")
    .replace(/access_token=[a-zA-Z0-9._-]+/g, "access_token=***");
}
