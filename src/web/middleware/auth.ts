import type { Context, Next } from "hono";
import type { AuthUser, SessionData } from "../../types.js";
import { AuthenticationError } from "../../utils/errors.js";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";

/**
 * Authentik OIDC Authentication Middleware
 * Compatible with openid-client v6 (functional API)
 *
 * openid-client v6 uses a completely different API from v5:
 * - No Issuer/Client classes
 * - Functional approach: discovery(), authorizationCodeGrant(), etc.
 * - PKCE built-in
 */

// Dynamic import for openid-client v6 functions
let oidcConfig: any = null;

/**
 * Initialize OIDC configuration (called once on startup)
 * Uses openid-client v6 discovery function
 */
export async function initializeOIDC(): Promise<void> {
  try {
    const discoveryUrl = process.env.AUTHENTIK_OIDC_DISCOVERY;
    if (!discoveryUrl) {
      console.warn(
        "[Auth] AUTHENTIK_OIDC_DISCOVERY not set, OIDC disabled. Set it in .env to enable SSO.",
      );
      return;
    }

    const openidClient = await import("openid-client");
    const issuerUrl = new URL(discoveryUrl);
    const clientId = process.env.AUTHENTIK_CLIENT_ID || "";
    const clientSecret = process.env.AUTHENTIK_CLIENT_SECRET;

    // openid-client v6: discovery(server, clientId, metadata|secret, clientAuth)
    // Explicitly use ClientSecretPost for Authentik compatibility
    oidcConfig = clientSecret
      ? await openidClient.discovery(
          issuerUrl,
          clientId,
          clientSecret,
          openidClient.ClientSecretPost(clientSecret),
        )
      : await openidClient.discovery(
          issuerUrl,
          clientId,
          undefined,
          openidClient.None(),
        );

    console.log("[Auth] OIDC client initialized successfully");
  } catch (error) {
    console.error("[Auth] Failed to initialize OIDC:", error);
    // Don't throw - allow app to start without OIDC for development
    console.warn("[Auth] Running without OIDC authentication");
  }
}

/**
 * Generate authorization URL for login redirect
 * Uses PKCE (S256) for security
 * Stores state in secure HTTP-only cookies
 */
export function getAuthorizationUrl(c?: Context): { url: string; cookies: Array<{ name: string; value: string; options: any }> } {
  if (!oidcConfig) {
    throw new AuthenticationError(
      "OIDC not initialized. Check AUTHENTIK_OIDC_DISCOVERY in .env",
    );
  }

  try {
    // openid-client v6: use buildAuthorizationUrl or manual URL construction
    const openidClient = require("openid-client");

    const codeVerifier = openidClient.randomPKCECodeVerifier();
    const codeChallenge = openidClient.calculatePKCECodeChallenge(codeVerifier);
    const nonce = openidClient.randomNonce();

    const redirectUri =
      process.env.AUTHENTIK_REDIRECT_URI ||
      "http://localhost:3000/auth/callback";

    // Generate a random state for CSRF protection
    const state = openidClient.randomState();

    // Build authorization URL
    const authUrl = openidClient.buildAuthorizationUrl(oidcConfig, {
      redirect_uri: redirectUri,
      scope: "openid profile email",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      nonce,
      state,
    });

    // Prepare cookies for state persistence
    const isProduction = process.env.NODE_ENV === "production";
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: "Lax" as const,
      path: "/",
      maxAge: 600, // 10 minutes for login process
    };
    const cookies = [
      {
        name: "pkce_code_verifier",
        value: codeVerifier,
        options: cookieOptions,
      },
      {
        name: "oidc_nonce",
        value: nonce,
        options: cookieOptions,
      },
      {
        name: "oidc_state",
        value: state,
        options: cookieOptions,
      },
    ];

    // If context provided, set cookies immediately
    if (c) {
      cookies.forEach(cookie => {
        setCookie(c, cookie.name, cookie.value, cookie.options);
      });
    }

    return { url: authUrl.href, cookies };
  } catch (error) {
    console.error("[Auth] Failed to build authorization URL:", error);
    throw new AuthenticationError("Failed to initiate login");
  }
}

/**
 * Exchange authorization code for tokens
 * Reads PKCE state from cookies set during login
 */
export async function exchangeCodeForToken(callbackUrl: string, c: Context): Promise<any> {
  if (!oidcConfig) {
    throw new AuthenticationError("OIDC not initialized");
  }

  try {
    const openidClient = await import("openid-client");
    const redirectUri =
      process.env.AUTHENTIK_REDIRECT_URI ||
      "http://localhost:3000/auth/callback";

    // Read PKCE + OIDC state from cookies (set during login)
    const codeVerifier = getCookie(c, "pkce_code_verifier");
    const nonce = getCookie(c, "oidc_nonce");
    const expectedState = getCookie(c, "oidc_state");

    if (!codeVerifier || !nonce || !expectedState) {
      throw new AuthenticationError(
        "OIDC session state not found. Please try logging in again.",
      );
    }

    const tokens = await openidClient.authorizationCodeGrant(
      oidcConfig,
      new URL(callbackUrl),
      {
        pkceCodeVerifier: codeVerifier,
        expectedNonce: nonce,
        expectedState,
        idTokenExpected: true,
      },
    );

    // Clear OIDC state cookies after successful exchange
    deleteCookie(c, "pkce_code_verifier", { path: "/" });
    deleteCookie(c, "oidc_nonce", { path: "/" });
    deleteCookie(c, "oidc_state", { path: "/" });

    return tokens;
  } catch (error) {
    console.error("[Auth] Token exchange failed:", error);
    // Clear state cookies on error too
    deleteCookie(c, "pkce_code_verifier", { path: "/" });
    deleteCookie(c, "oidc_nonce", { path: "/" });
    deleteCookie(c, "oidc_state", { path: "/" });
    throw new AuthenticationError("Failed to exchange code for tokens");
  }
}

/**
 * Decode JWT token payload (simple base64 decode)
 * Note: In production, verify signature with OIDC provider's public key
 */
function decodeJWT(token: string): Record<string, any> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid token format");

    const decoded = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(decoded);
  } catch (error) {
    console.error("[Auth] JWT decode failed:", error);
    return {};
  }
}

/**
 * Extract user info from ID token claims
 */
export function extractUserFromToken(idToken: string): AuthUser {
  const decoded = decodeJWT(idToken);

  if (!decoded.sub) {
    throw new AuthenticationError("Missing 'sub' claim in ID token");
  }

  return {
    sub: decoded.sub,
    email: decoded.email || "",
    name: decoded.name || decoded.preferred_username || decoded.email || "User",
    groups: decoded.groups || [],
  };
}

/**
 * Verify and decode access token, return session data
 */
export function verifyAccessToken(token: string): SessionData {
  const decoded = decodeJWT(token);

  if (!decoded.sub) {
    throw new AuthenticationError("Invalid access token");
  }

  // Check expiry
  const expiresAt = decoded.exp ? decoded.exp * 1000 : Date.now() + 3600 * 1000;

  return {
    userId: decoded.sub,
    email: decoded.email || "",
    accessToken: token,
    expiresAt,
  };
}

/**
 * Auth Middleware: Extract and validate session from cookie
 * Sets isAuthenticated, user, and sessionData on context
 */
export async function authMiddleware(c: Context, next: Next): Promise<void> {
  try {
    const cookieHeader = c.req.header("cookie");

    if (!cookieHeader) {
      c.set("isAuthenticated", false);
      return next();
    }

    // Parse access_token from cookie
    const tokenMatch = cookieHeader.match(/access_token=([^;]+)/);
    if (!tokenMatch) {
      c.set("isAuthenticated", false);
      return next();
    }

    const token = decodeURIComponent(tokenMatch[1]);
    const sessionData = verifyAccessToken(token);

    // Check if token is expired
    if (sessionData.expiresAt < Date.now()) {
      c.set("isAuthenticated", false);
      return next();
    }

    // Extract user from token
    const user = extractUserFromToken(token);

    c.set("isAuthenticated", true);
    c.set("user", user);
    c.set("sessionData", sessionData);

    return next();
  } catch (error) {
    // Auth failure should not block the request - just mark as unauthenticated
    c.set("isAuthenticated", false);
    return next();
  }
}

/**
 * Guard: Check if current request is authenticated
 */
export function requireAuth(c: Context): boolean {
  return c.get("isAuthenticated") === true;
}

/**
 * Get authenticated user from context
 */
export function getAuthUser(c: Context): AuthUser | undefined {
  if (!requireAuth(c)) return undefined;
  return c.get("user");
}

/**
 * Get session data from context
 */
export function getSessionData(c: Context): SessionData | undefined {
  if (!requireAuth(c)) return undefined;
  return c.get("sessionData");
}

/**
 * Check if OIDC is configured and available
 */
export function isOIDCEnabled(): boolean {
  return oidcConfig !== null;
}
