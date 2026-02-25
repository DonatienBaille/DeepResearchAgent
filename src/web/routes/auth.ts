import { Hono } from "hono";
import type { Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import {
  getAuthorizationUrl,
  exchangeCodeForToken,
  extractUserFromToken,
  isOIDCEnabled,
} from "../middleware/auth.js";

/**
 * Auth Routes: OIDC login/logout/callback flow
 */

export const authRouter = new Hono<any>();

/**
 * GET /auth/login - Initiate OIDC login flow
 */
authRouter.get("/login", (c: Context<any>) => {
  try {
    if (!isOIDCEnabled()) {
      return c.html(`
        <!DOCTYPE html>
        <html lang="fr">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
          <title>Connexion — Deep Research Agent</title>
          <style>
            *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              background: #0f1117;
              color: #e8eaed;
              padding: 24px;
              -webkit-font-smoothing: antialiased;
            }
            .login-card {
              background: #1a1d2e;
              border: 1px solid #2a2d3e;
              border-radius: 16px;
              padding: 48px 40px;
              max-width: 420px;
              width: 100%;
              text-align: center;
              box-shadow: 0 16px 48px rgba(0,0,0,.3);
            }
            .login-icon {
              width: 56px; height: 56px;
              margin: 0 auto 20px;
              background: rgba(99,102,241,.12);
              border-radius: 14px;
              display: flex; align-items: center; justify-content: center;
            }
            .login-icon svg { width: 28px; height: 28px; color: #6366f1; }
            h1 { font-size: 1.375rem; font-weight: 700; margin-bottom: 8px; letter-spacing: -0.01em; }
            .subtitle { color: #9ca3af; font-size: 0.875rem; margin-bottom: 24px; line-height: 1.5; }
            .info-box {
              background: #161822;
              border: 1px solid #2a2d3e;
              border-radius: 10px;
              padding: 14px 16px;
              font-size: 0.8125rem;
              color: #9ca3af;
              line-height: 1.5;
              margin-bottom: 24px;
              text-align: left;
            }
            .info-box code {
              background: rgba(99,102,241,.12);
              color: #818cf8;
              padding: 1px 6px;
              border-radius: 4px;
              font-size: 0.75rem;
              font-family: 'JetBrains Mono', monospace;
            }
            .btn {
              display: inline-flex; align-items: center; justify-content: center; gap: 8px;
              padding: 11px 28px;
              background: #6366f1;
              color: #fff;
              border: none;
              border-radius: 8px;
              font-size: 0.9375rem;
              font-weight: 600;
              font-family: inherit;
              cursor: pointer;
              text-decoration: none;
              transition: background 150ms ease;
            }
            .btn:hover { background: #818cf8; }
            .btn:focus-visible { outline: 2px solid #6366f1; outline-offset: 2px; }
            .btn svg { width: 18px; height: 18px; }
            .footer-note { margin-top: 20px; font-size: 0.75rem; color: #6b7280; }
          </style>
        </head>
        <body>
          <main class="login-card" role="main">
            <div class="login-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>
            </div>
            <h1>Deep Research Agent</h1>
            <p class="subtitle">Veille technologique automatisée</p>
            <div class="info-box">
              L'authentification OIDC n'est pas configurée.<br/>
              Définissez <code>AUTHENTIK_OIDC_DISCOVERY</code> dans votre fichier <code>.env</code> pour activer le SSO.
            </div>
            <a href="/dashboard" class="btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
              Accéder au Dashboard
            </a>
            <p class="footer-note">Mode développement — accès sans authentification</p>
          </main>
        </body>
        </html>
      `);
    }

    const { url: authUrl } = getAuthorizationUrl(c);
    return c.redirect(authUrl);
  } catch (error) {
    console.error("[Auth Route] Login redirect failed:", error);
    return c.text(
      "Authentication initialization failed. Check server logs.",
      500,
    );
  }
});

/**
 * GET /auth/callback - OIDC callback handler
 */
authRouter.get("/callback", async (c: Context<any>) => {
  try {
    const code = c.req.query("code");
    const error = c.req.query("error");

    if (error) {
      const errorDesc = c.req.query("error_description") || error;
      console.error("[Auth Route] OIDC error:", errorDesc);
      return c.text(`Authentication error: ${errorDesc}`, 400);
    }

    if (!code) {
      return c.text("Authorization code not found in callback", 400);
    }

    // Build full callback URL for token exchange
    const callbackUrl = c.req.url;

    // Exchange code for tokens (pass context for PKCE state recovery)
    const tokens = await exchangeCodeForToken(callbackUrl, c);

    const idToken = tokens.id_token;
    const accessToken = tokens.access_token;

    if (!idToken || !accessToken) {
      return c.text("Failed to obtain tokens from provider", 500);
    }

    // Validate we can extract user info
    extractUserFromToken(idToken);

    // Set session cookies
    const isProduction = process.env.NODE_ENV === "production";
    const expiresIn = tokens.expires_in || 3600;

    setCookie(c, "access_token", accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "Lax",
      path: "/",
      maxAge: expiresIn,
    });

    if (tokens.refresh_token) {
      setCookie(c, "refresh_token", tokens.refresh_token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: "Lax",
        path: "/",
        maxAge: 7 * 24 * 60 * 60, // 7 days
      });
    }

    // Store ID token for user info retrieval
    setCookie(c, "id_token", idToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "Lax",
      path: "/",
      maxAge: expiresIn,
    });

    return c.redirect("/dashboard");
  } catch (error) {
    console.error("[Auth Route] Callback handler error:", error);
    return c.text("Authentication failed. Please try again.", 500);
  }
});

/**
 * GET /auth/logout - Logout and clear session
 */
authRouter.get("/logout", async (c: Context<any>) => {
  try {
    // Clear all session cookies
    deleteCookie(c, "access_token", { path: "/" });
    deleteCookie(c, "refresh_token", { path: "/" });
    deleteCookie(c, "id_token", { path: "/" });

    return c.redirect("/auth/login?logout=true");
  } catch (error) {
    console.error("[Auth Route] Logout error:", error);
    // Still clear cookies even if something fails
    deleteCookie(c, "access_token", { path: "/" });
    deleteCookie(c, "refresh_token", { path: "/" });
    deleteCookie(c, "id_token", { path: "/" });
    return c.redirect("/auth/login?logout=true");
  }
});

/**
 * GET /auth/user - Get current user info
 * Used by frontend to check auth status and display user data
 */
authRouter.get("/user", (c: Context<any>) => {
  const user = c.get("user");
  const isAuthenticated = c.get("isAuthenticated") || false;

  if (!isAuthenticated || !user) {
    return c.json({ authenticated: false }, 401);
  }

  return c.json({
    authenticated: true,
    user: {
      id: user.sub,
      email: user.email,
      name: user.name,
      groups: user.groups || [],
    },
  });
});
