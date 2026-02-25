import { describe, it, expect } from "bun:test";
import {
  AppError,
  NotFoundError,
  ValidationError,
  ConflictError,
  AuthenticationError,
  ForbiddenError,
  ExternalServiceError,
  AgentError,
  DatabaseError,
  formatErrorResponse,
  getErrorStatusCode,
  sanitizeErrorForLog,
} from "../../src/utils/errors.js";

/**
 * Unit Tests for Custom Error Classes
 */

describe("Errors - AppError", () => {
  it("should create error with defaults", () => {
    const err = new AppError("Something failed");

    expect(err.message).toBe("Something failed");
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.statusCode).toBe(500);
    expect(err.isOperational).toBe(true);
    expect(err.name).toBe("AppError");
    expect(err instanceof Error).toBe(true);
  });

  it("should create error with custom properties", () => {
    const err = new AppError("Custom", "CUSTOM_CODE", 418, false);

    expect(err.code).toBe("CUSTOM_CODE");
    expect(err.statusCode).toBe(418);
    expect(err.isOperational).toBe(false);
  });
});

describe("Errors - NotFoundError", () => {
  it("should create 404 error with resource name", () => {
    const err = new NotFoundError("Topic");

    expect(err.message).toBe("Topic not found");
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
  });

  it("should include ID in message", () => {
    const err = new NotFoundError("Topic", "abc-123");

    expect(err.message).toBe('Topic with id "abc-123" not found');
  });
});

describe("Errors - ValidationError", () => {
  it("should create 400 error", () => {
    const err = new ValidationError("Name required", "name");

    expect(err.message).toBe("Name required");
    expect(err.statusCode).toBe(400);
    expect(err.field).toBe("name");
  });
});

describe("Errors - ConflictError", () => {
  it("should create 409 error", () => {
    const err = new ConflictError("Topic", "TypeScript");

    expect(err.message).toBe('Topic "TypeScript" already exists');
    expect(err.statusCode).toBe(409);
  });
});

describe("Errors - AuthenticationError", () => {
  it("should create 401 error with default message", () => {
    const err = new AuthenticationError();

    expect(err.message).toBe("Authentication required");
    expect(err.statusCode).toBe(401);
  });
});

describe("Errors - ForbiddenError", () => {
  it("should create 403 error", () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
  });
});

describe("Errors - ExternalServiceError", () => {
  it("should include service name", () => {
    const err = new ExternalServiceError("Tavily", "Rate limited");

    expect(err.message).toBe("Tavily: Rate limited");
    expect(err.statusCode).toBe(502);
    expect(err.service).toBe("Tavily");
  });
});

describe("Errors - AgentError", () => {
  it("should include topic and iteration", () => {
    const err = new AgentError("TypeScript", "Timeout", 2);

    expect(err.message).toContain("TypeScript");
    expect(err.message).toContain("iteration 2");
    expect(err.topic).toBe("TypeScript");
    expect(err.iteration).toBe(2);
  });
});

describe("Errors - DatabaseError", () => {
  it("should include operation name", () => {
    const err = new DatabaseError("insert", "Constraint violation");

    expect(err.message).toContain("insert");
    expect(err.message).toContain("Constraint violation");
  });
});

describe("Errors - formatErrorResponse", () => {
  it("should format AppError", () => {
    const err = new NotFoundError("Topic", "123");
    const response = formatErrorResponse(err);

    expect(response.success).toBe(false);
    expect(response.error).toContain("Topic");
    expect(response.code).toBe("NOT_FOUND");
    expect(response.timestamp).toBeTruthy();
  });

  it("should format generic Error", () => {
    const response = formatErrorResponse(new Error("Generic"));

    expect(response.success).toBe(false);
    expect(response.error).toBe("Generic");
    expect(response.code).toBeUndefined();
  });

  it("should format unknown error", () => {
    const response = formatErrorResponse("string error");

    expect(response.success).toBe(false);
    expect(response.error).toBe("An unexpected error occurred");
  });
});

describe("Errors - getErrorStatusCode", () => {
  it("should return status from AppError", () => {
    expect(getErrorStatusCode(new NotFoundError("X"))).toBe(404);
    expect(getErrorStatusCode(new ValidationError("X"))).toBe(400);
    expect(getErrorStatusCode(new AuthenticationError())).toBe(401);
  });

  it("should return 500 for generic errors", () => {
    expect(getErrorStatusCode(new Error("generic"))).toBe(500);
    expect(getErrorStatusCode("string")).toBe(500);
  });
});

describe("Errors - sanitizeErrorForLog", () => {
  it("should mask OpenAI API keys", () => {
    const result = sanitizeErrorForLog(
      new Error("Failed with key sk-abc123xyz456"),
    );
    expect(result).not.toContain("sk-abc123xyz456");
    expect(result).toContain("sk-***");
  });

  it("should mask Tavily API keys", () => {
    const result = sanitizeErrorForLog("Error: tvly-myapikey123");
    expect(result).not.toContain("tvly-myapikey123");
    expect(result).toContain("tvly-***");
  });

  it("should mask Bearer tokens", () => {
    const result = sanitizeErrorForLog("Bearer eyJhbGciOi.something.here");
    expect(result).toContain("Bearer ***");
  });

  it("should handle non-error inputs", () => {
    expect(sanitizeErrorForLog(42)).toBe("42");
    expect(sanitizeErrorForLog(null)).toBe("null");
  });
});
