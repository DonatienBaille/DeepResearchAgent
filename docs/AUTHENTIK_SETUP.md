# Authentik OIDC Setup Guide

Complete instructions for configuring Authentik as the SSO provider for Deep Research Agent.

---

## Table of Contents

1. [Authentik Instance Setup](#authentik-instance-setup)
2. [Create OAuth2/OIDC Application](#create-oauth2oidc-application)
3. [Configure Deep Research Agent](#configure-deep-research-agent)
4. [Test the Integration](#test-the-integration)
5. [Troubleshooting](#troubleshooting)

---

## Authentik Instance Setup

### Option A: Self-Hosted Authentik (Docker)

If you don't have Authentik running, start it with docker-compose:

```bash
# Add to docker-compose.yml
# See: https://goauthentik.io/docs/installation/docker-compose/

services:
  authentik:
    image: ghcr.io/goauthentik/server:latest
    ports:
      - "9000:9000"  # HTTP
      - "9443:9443"  # HTTPS
    environment:
      AUTHENTIK_SECRET_KEY: ${AUTHENTIK_SECRET_KEY:-generate-random-key}
      AUTHENTIK_POSTGRESQL__HOST: postgres
      AUTHENTIK_POSTGRESQL__NAME: authentik
      AUTHENTIK_POSTGRESQL__USER: authentik
      AUTHENTIK_POSTGRESQL__PASSWORD: ${AUTHENTIK_POSTGRES_PASSWORD:-authentik}
    volumes:
      - ./authentik/media:/media
    depends_on:
      - postgres

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: authentik
      POSTGRES_USER: authentik
      POSTGRES_PASSWORD: ${AUTHENTIK_POSTGRES_PASSWORD:-authentik}
    volumes:
      - authentik-postgres:/var/lib/postgresql/data
```

Start Authentik:

```bash
docker-compose up authentik postgres
```

Access Authentik admin:

- **URL**: https://localhost:9443 (or http://localhost:9000)
- **Default credentials**:
  - Username: `akadmin`
  - Password: `akadmin` (change immediately in production)

### Option B: External Authentik Instance

If using a cloud or external Authentik:

- Note the base URL (e.g., `https://authentik.example.com`)
- Ensure it's accessible from your Deep Research Agent deployment
- HTTPS is required for OIDC in production

---

## Create OAuth2/OIDC Application

### Step 1: Navigate to Applications

1. Log in to Authentik admin at `https://authentik.example.com/admin`
2. Go to **Applications** → **Applications**
3. Click **Create** button

### Step 2: Create Application

Fill in the form:

| Field     | Value               | Notes               |
| --------- | ------------------- | ------------------- |
| **Name**  | Deep Research Agent | User-friendly name  |
| **Slug**  | deep-agent          | URL-safe identifier |
| **Group** | (leave default)     | Optional grouping   |

Click **Create** and continue to next step.

### Step 3: Create OIDC Provider

1. After creating the app, you'll be redirected to edit the application
2. Scroll down to **Provider** section
3. Click **Create OIDC Provider** or select existing provider
4. Fill in OIDC Configuration:

| Field                   | Value                                 | Notes                                  |
| ----------------------- | ------------------------------------- | -------------------------------------- |
| **Name**                | Deep Research OIDC                    | Descriptive name                       |
| **Authentication Flow** | default-authorization-flow            | Default is fine                        |
| **Authorization Flow**  | default-authorization-flow            | Default is fine                        |
| **Redirect URIs**       | `http://localhost:3000/auth/callback` | Include all URLs where app is deployed |
| **Client Type**         | Confidential                          | For secure backend app                 |
| **Scopes**              | `openid profile email`                | Select these checkboxes                |

**Important Redirect URIs:**

- Local: `http://localhost:3000/auth/callback`
- Staging: `https://staging.example.com/auth/callback`
- Production: `https://research.example.com/auth/callback`

Click **Create** to save the OIDC provider.

### Step 4: Get Client Credentials

After creating the OIDC provider:

1. The provider will appear in the **Provider** dropdown
2. Click on the provider name to view details
3. You'll see:
   - **Client ID**: Copy this value
   - **Client Secret**: Click to reveal and copy
   - **Authorization Endpoint**: `https://authentik.example.com/application/o/authorize/`
   - **Token Endpoint**: `https://authentik.example.com/application/o/token/`
   - **Userinfo Endpoint**: `https://authentik.example.com/application/o/userinfo/`
   - **Discovery Endpoint**: `https://authentik.example.com/application/o/deep-agent/.well-known/openid-configuration`

**Save these for later!**

---

## Configure Deep Research Agent

### Step 1: Update `.env` File

Edit your `.env` file with Authentik credentials:

```bash
# Authentik OIDC Configuration
AUTHENTIK_OIDC_DISCOVERY=https://authentik.example.com/application/o/deep-agent/.well-known/openid-configuration
AUTHENTIK_CLIENT_ID=your-client-id-here
AUTHENTIK_CLIENT_SECRET=your-client-secret-here
AUTHENTIK_REDIRECT_URI=http://localhost:3000/auth/callback
# For production, use: https://research.example.com/auth/callback

# Session security
SESSION_SECRET=your-32-character-minimum-random-secret-key-here
```

### Step 2: Verify OIDC Discovery URL

Test that the discovery URL is accessible:

```bash
curl https://authentik.example.com/application/o/deep-agent/.well-known/openid-configuration
```

Expected response includes:

```json
{
  "issuer": "https://authentik.example.com",
  "authorization_endpoint": "https://authentik.example.com/application/o/authorize/",
  "token_endpoint": "https://authentik.example.com/application/o/token/",
  "userinfo_endpoint": "https://authentik.example.com/application/o/userinfo/",
  ...
}
```

### Step 3: Network Configuration

If using Docker:

- **Local Authentik**: Both containers on same network (`deep-network`)
- **External Authentik**: Ensure Deep Research Agent can reach Authentik URL

Update `docker-compose.yml`:

```yaml
services:
  deep-agent:
    # ...
    environment:
      AUTHENTIK_OIDC_DISCOVERY: https://authentik.example.com/application/o/deep-agent/.well-known/openid-configuration
```

---

## Test the Integration

### Step 1: Start Deep Research Agent

```bash
# Local development
bun run src/web.ts
bun run src/index.ts

# Or with Docker
docker-compose up -d
```

### Step 2: Test Login Flow

1. Open browser: `http://localhost:3000/dashboard`
2. You should be redirected to: `http://localhost:3000/auth/login`
3. Clicking login redirects to Authentik login page
4. Log in with your Authentik credentials
5. You'll be redirected back to dashboard with authenticated session
6. Dashboard should display your user name and email

### Step 3: Verify Session Persistence

1. Refresh the dashboard page
2. Should remain logged in (session cookie valid)
3. Click "Logout" button
4. Should redirect to login page

### Step 4: Test Topic Management

1. While logged in, add a new topic via the dashboard
2. Topic should appear in the list
3. Toggle active/inactive
4. Delete a topic
5. All operations should work smoothly

---

## Troubleshooting

### "Failed to discover OIDC provider"

**Symptoms:**

```
Error: Failed to get document at https://authentik.example.com/...well-known/openid-configuration
```

**Solutions:**

1. Verify Authentik is running and accessible
2. Check URL format: should end with `/deep-agent/.well-known/openid-configuration`
3. Test discovery URL manually:
   ```bash
   curl -v https://authentik.example.com/application/o/deep-agent/.well-known/openid-configuration
   ```
4. If using self-signed HTTPS: disable SSL verification in development only
   ```typescript
   // In auth.ts, set NODE_TLS_REJECT_UNAUTHORIZED=0 (dev only!)
   ```

### "Invalid client credentials"

**Symptoms:**

```
Error: Client authentication failed (e.g., unknown client, no client authentication included)
```

**Solutions:**

1. Verify `AUTHENTIK_CLIENT_ID` is exactly correct (copy from Authentik admin)
2. Verify `AUTHENTIK_CLIENT_SECRET` is exactly correct and not trimmed
3. Check client is "Confidential" type in Authentik
4. Ensure provider is created and linked to application

### "Redirect URI mismatch"

**Symptoms:**

```
redirect_uri_mismatch: The open-id-connect provider does not have a matching redirect uri.
```

**Solutions:**

1. In Authentik admin, edit the OIDC provider
2. Check **Redirect URIs** field exactly matches your application URL:
   - Local: `http://localhost:3000/auth/callback`
   - Production: `https://research.example.com/auth/callback` (HTTPS required!)
3. Whitespace matters - ensure no trailing slashes or spaces

### "Login page doesn't redirect back"

**Symptoms:**

- After entering credentials in Authentik, page stalls
- Console shows CORS or network errors

**Solutions:**

1. Check `AUTHENTIK_REDIRECT_URI` matches exactly what's registered in Authentik
2. Verify Deep Research Agent is accessible at that URL from the browser
3. Check browser console for CORS errors
4. If using HTTPS for Authentik, ensure app also uses HTTPS
5. Clear browser cookies and try again

### "Session expires immediately"

**Symptoms:**

- Login successful but dashboard redirects to login again
- Session cookie not being set

**Solutions:**

1. Check `SESSION_SECRET` is set and at least 32 characters
2. Verify token expiry: `expiresAt` should be future timestamp
3. Check browser allows cookies (3rd-party cookie policy)
4. In development, set `sameSite: Lax` in cookie options
5. For production, use `sameSite: Strict` with secure HTTPS

### "User email is not populated"

**Symptoms:**

- Login works, but user email shows as empty
- Dashboard shows user name but no email

**Solutions:**

1. In Authentik admin, verify the OIDC provider includes `email` scope
2. Check user being authenticated has email field set in Authentik
3. Verify IdP (if using external) is passing email claim
4. Update scopes in OIDC provider: `openid profile email`

### "HTTPS certificate errors"

**Symptoms:**

```
Error: unable to verify the first certificate
```

**Solutions:**

1. For production: use valid SSL certificate from CA (Let's Encrypt)
2. For development: accept self-signed certs with env var (Bun only):
   ```bash
   NODE_TLS_REJECT_UNAUTHORIZED=0 bun run src/web.ts
   ```
3. Better for dev: use ngrok or local HTTPS proxy
4. Update Authentik "Redirect URIs" to match actual domain/SSL setup

---

## Advanced Configuration

### Multiple Redirect URIs

If deploying to multiple environments:

```
Redirect URIs (comma or newline separated):
http://localhost:3000/auth/callback
https://staging.example.com/auth/callback
https://research.example.com/auth/callback
```

### Custom User Attributes

Map additional OIDC claims to user context in `auth.ts`:

```typescript
export function extractUserFromToken(idToken: string): AuthUser {
  const decoded = decode(idToken) as any;

  return {
    sub: decoded.sub,
    email: decoded.email,
    name: decoded.name,
    groups: decoded.groups,
    // Add custom claims:
    department: decoded.department,
    role: decoded.role,
  };
}
```

### Session Timeout

Adjust session expiry in `.env`:

```bash
# Token still expires per OIDC, but you can add custom refresh logic
# Default: respects OIDC token expiry (typically 3600 seconds)
```

### Rate Limiting

Add rate limiting on login endpoint in `web.ts`:

```typescript
app.post("/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }), ...)
```

---

## Security Checklist

- [ ] Use HTTPS (both Authentik and application) in production
- [ ] Change default Authentik password immediately
- [ ] Use strong `SESSION_SECRET` (32+ chars, random)
- [ ] Set `SMTP_SECURE=true` for email
- [ ] Enable CORS only for trusted domains
- [ ] Regularly rotate `AUTHENTIK_CLIENT_SECRET`
- [ ] Keep Authentik and dependencies updated
- [ ] Monitor failed login attempts
- [ ] Use environment variables for all secrets (never hardcode)
- [ ] Backup Authentik database regularly

---

## Support Resources

- **Authentik Docs**: https://goauthentik.io/docs/
- **OIDC Spec**: https://openid.net/specs/openid-connect-core-1_0.html
- **Troubleshooting**: https://goauthentik.io/docs/troubleshooting/
- **Community Forum**: https://community.goauthentik.io/

---

Last Updated: 2026-02-24
