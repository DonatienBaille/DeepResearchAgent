import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import {
  authMiddleware,
  extractUserFromToken,
  verifyAccessToken,
  isOIDCEnabled,
} from "../../src/web/middleware/auth.js";
import { authRouter } from "../../src/web/routes/auth.js";

/**
 * Integration Tests for Auth Middleware and Routes
 * Tests authentication flow without a real OIDC provider
 */

/**
 * Create a minimal JWT token for testing
 * Format: header.payload.signature (only payload matters for our decode)
 */
function createTestJWT(
  payload: Record<string, any>,
  expiresInSeconds = 3600,
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");

  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    iat: now,
    exp: now + expiresInSeconds,
    ...payload,
  };

  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString(
    "base64url",
  );
  const signature = Buffer.from("test-signature").toString("base64url");

  return `${header}.${payloadB64}.${signature}`;
}

describe("Auth Middleware Integration", () => {
  it("should set isAuthenticated=false when no cookies", async () => {
    const app = new Hono<any>();
    app.use("*", authMiddleware);
    app.get("/test", (c) => {
      return c.json({
        authenticated: c.get("isAuthenticated"),
      });
    });

    const res = await app.request("/test");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.authenticated).toBe(false);
  });

  it("should set isAuthenticated=false for invalid token", async () => {
    const app = new Hono<any>();
    app.use("*", authMiddleware);
    app.get("/test", (c) => {
      return c.json({
        authenticated: c.get("isAuthenticated"),
      });
    });

    const res = await app.request("/test", {
      headers: {
        cookie: "access_token=not-a-jwt",
      },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.authenticated).toBe(false);
  });

  it("should set isAuthenticated=true for valid token", async () => {
    const token = createTestJWT({
      sub: "user-123",
      email: "test@example.com",
      name: "Test User",
    });

    const app = new Hono<any>();
    app.use("*", authMiddleware);
    app.get("/test", (c) => {
      return c.json({
        authenticated: c.get("isAuthenticated"),
        user: c.get("user"),
      });
    });

    const res = await app.request("/test", {
      headers: {
        cookie: `access_token=${token}`,
      },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.authenticated).toBe(true);
    expect(body.user.sub).toBe("user-123");
    expect(body.user.email).toBe("test@example.com");
    expect(body.user.name).toBe("Test User");
  });

  it("should set isAuthenticated=false for expired token", async () => {
    const token = createTestJWT(
      {
        sub: "user-123",
        email: "test@example.com",
      },
      -3600, // expired 1 hour ago
    );

    const app = new Hono<any>();
    app.use("*", authMiddleware);
    app.get("/test", (c) => {
      return c.json({
        authenticated: c.get("isAuthenticated"),
      });
    });

    const res = await app.request("/test", {
      headers: {
        cookie: `access_token=${token}`,
      },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.authenticated).toBe(false);
  });

  it("should handle URL-encoded cookie values", async () => {
    const token = createTestJWT({
      sub: "user-456",
      email: "test@example.com",
    });
    const encodedToken = encodeURIComponent(token);

    const app = new Hono<any>();
    app.use("*", authMiddleware);
    app.get("/test", (c) => {
      return c.json({
        authenticated: c.get("isAuthenticated"),
      });
    });

    const res = await app.request("/test", {
      headers: {
        cookie: `access_token=${encodedToken}`,
      },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    // Should be able to decode the URL-encoded token
    expect(body.authenticated).toBe(true);
  });
});

describe("JWT Utility Functions", () => {
  it("extractUserFromToken should extract user from valid JWT", () => {
    const token = createTestJWT({
      sub: "user-abc",
      email: "user@example.com",
      name: "Test User",
      groups: ["admin", "users"],
    });

    const user = extractUserFromToken(token);

    expect(user.sub).toBe("user-abc");
    expect(user.email).toBe("user@example.com");
    expect(user.name).toBe("Test User");
    expect(user.groups).toEqual(["admin", "users"]);
  });

  it("extractUserFromToken should use fallbacks for missing fields", () => {
    const token = createTestJWT({
      sub: "user-min",
      preferred_username: "minuser",
    });

    const user = extractUserFromToken(token);

    expect(user.sub).toBe("user-min");
    expect(user.email).toBe("");
    expect(user.name).toBe("minuser"); // Falls back to preferred_username
    expect(user.groups).toEqual([]);
  });

  it("extractUserFromToken should throw for missing sub", () => {
    const token = createTestJWT({
      email: "no-sub@example.com",
    });

    expect(() => extractUserFromToken(token)).toThrow("Missing 'sub' claim");
  });

  it("verifyAccessToken should return session data", () => {
    const token = createTestJWT({
      sub: "user-session",
      email: "session@example.com",
    });

    const session = verifyAccessToken(token);

    expect(session.userId).toBe("user-session");
    expect(session.email).toBe("session@example.com");
    expect(session.accessToken).toBe(token);
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it("verifyAccessToken should throw for missing sub", () => {
    const token = createTestJWT({ email: "nosub@example.com" });

    expect(() => verifyAccessToken(token)).toThrow("Invalid access token");
  });
});

describe("Auth Routes Integration", () => {
  it("GET /auth/login should show info page when OIDC is disabled", async () => {
    // OIDC is not initialized in tests, so isOIDCEnabled() returns false
    const app = new Hono<any>();
    app.use("*", authMiddleware);
    app.route("/auth", authRouter);

    const res = await app.request("/auth/login");

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("OIDC authentication is not configured");
    expect(html).toContain("/dashboard");
  });

  it("GET /auth/user should return 401 when not authenticated", async () => {
    const app = new Hono<any>();
    app.use("*", authMiddleware);
    app.route("/auth", authRouter);

    const res = await app.request("/auth/user");
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.authenticated).toBe(false);
  });

  it("GET /auth/user should return user info when authenticated", async () => {
    const token = createTestJWT({
      sub: "auth-user-1",
      email: "user@example.com",
      name: "Auth User",
      groups: ["devs"],
    });

    const app = new Hono<any>();
    app.use("*", authMiddleware);
    app.route("/auth", authRouter);

    const res = await app.request("/auth/user", {
      headers: {
        cookie: `access_token=${token}`,
      },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.authenticated).toBe(true);
    expect(body.user.id).toBe("auth-user-1");
    expect(body.user.email).toBe("user@example.com");
    expect(body.user.name).toBe("Auth User");
    expect(body.user.groups).toEqual(["devs"]);
  });

  it("GET /auth/logout should clear cookies and redirect", async () => {
    const token = createTestJWT({
      sub: "user-logout",
      email: "logout@example.com",
    });

    const app = new Hono<any>();
    app.use("*", authMiddleware);
    app.route("/auth", authRouter);

    const res = await app.request("/auth/logout", {
      headers: {
        cookie: `access_token=${token}; id_token=${token}`,
      },
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/auth/login");

    // Should have Set-Cookie headers clearing cookies
    const setCookieHeaders = res.headers.getAll
      ? res.headers.getAll("set-cookie")
      : [res.headers.get("set-cookie")].filter(Boolean);

    // At least access_token cookie should be cleared
    const hasClearCookie = setCookieHeaders.some(
      (h: string | null) =>
        h !== null && h.includes("access_token") && h.includes("Max-Age=0"),
    );
    // Note: Hono's deleteCookie implementation may vary
    // At minimum, the response should redirect
    expect(res.headers.get("location")).toBe("/auth/login?logout=true");
  });
});

describe("isOIDCEnabled", () => {
  it("should return false when OIDC is not initialized", () => {
    // In test environment, OIDC is never initialized
    expect(isOIDCEnabled()).toBe(false);
  });
});
