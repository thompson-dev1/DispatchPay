# DispatchPay Deployment Architecture

**Target Stack**: Netlify (Frontends) · Render (Backend API) · Turso (Database)  
**Environment Model**: `development` → `staging` → `production`

This document specifies every configuration, secret, CI/CD step, monitoring hook, and rollback procedure required to deploy DispatchPay safely into production.

---

## 1. Infrastructure Topology

```
                         +──────────────────────────────────────────────────────+
                         │                   CLOUDFLARE (Edge)                  │
                         │          WAF · DDoS · SSL Termination · CDN          │
                         +──────────────┬─────────────────────┬─────────────────+
                                        │                     │
                   ┌────────────────────▼──────┐   ┌──────────▼────────────────────┐
                   │         NETLIFY           │   │            RENDER             │
                   │  ┌─────────────────────┐  │   │  ┌─────────────────────────┐  │
                   │  │   business-web SPA  │  │   │  │  backend-api (Node.js)  │  │
                   │  │  dashboard.dispatch │  │   │  │  api.dispatchpay.com    │  │
                   │  │  pay.com            │  │   │  └──────────┬──────────────┘  │
                   │  └─────────────────────┘  │   │            │ libSQL client    │
                   │  ┌─────────────────────┐  │   │            │                  │
                   │  │   rider-pwa (PWA)   │  │   └────────────│──────────────────┘
                   │  │  app.dispatchpay    │  │                │
                   │  │  .com               │  │                ▼
                   │  └─────────────────────┘  │   +──────────────────────────────+
                   └───────────────────────────┘   │           TURSO              │
                                                   │  Primary (eu-west-1)         │
                                                   │  Replica (af-south-1)        │
                                                   +──────────────────────────────+
                                                                │
                                                   +──────────────────────────────+
                                                   │       UPSTASH REDIS          │
                                                   │  OTP · Rate limits · JTI     │
                                                   │  blocklist · Session cache   │
                                                   +──────────────────────────────+
```

---

## 2. Environment Model

Three environments mirror the same topology with isolated databases and secrets:

| Layer | Development | Staging | Production |
| :--- | :--- | :--- | :--- |
| **Frontend URL** | `localhost:5173` | `staging-dashboard.dispatchpay.com` | `dashboard.dispatchpay.com` |
| **Rider PWA URL** | `localhost:5174` | `staging-app.dispatchpay.com` | `app.dispatchpay.com` |
| **API URL** | `localhost:3000` | `staging-api.dispatchpay.com` | `api.dispatchpay.com` |
| **Database** | Local SQLite file | Turso `dispatchpay-staging` | Turso `dispatchpay-prod` |
| **Redis** | Docker local | Upstash staging DB | Upstash production DB |
| **Moolre** | Mock server (msw) | Moolre Sandbox | Moolre Live |

---

## 3. Environment Variables

### Backend API (Render Service)

All secrets are injected as Render Environment Variables — never committed to source control.

```bash
# ────────────────────────────────────────────────
# APPLICATION
# ────────────────────────────────────────────────
NODE_ENV=production
PORT=3000
API_BASE_URL=https://api.dispatchpay.com
FRONTEND_URL=https://dashboard.dispatchpay.com
RIDER_APP_URL=https://app.dispatchpay.com
LOG_LEVEL=info

# ────────────────────────────────────────────────
# DATABASE (Turso)
# ────────────────────────────────────────────────
TURSO_DATABASE_URL=libsql://dispatchpay-prod-[org].turso.io
TURSO_AUTH_TOKEN=eyJhbGci...  # Long-lived Turso JWT

# ────────────────────────────────────────────────
# REDIS (Upstash)
# ────────────────────────────────────────────────
UPSTASH_REDIS_URL=https://[db-name].upstash.io
UPSTASH_REDIS_TOKEN=AXxx...

# ────────────────────────────────────────────────
# JWT SIGNING
# ────────────────────────────────────────────────
JWT_SECRET=<min-64-char-random-hex>          # HS256 for development
JWT_PRIVATE_KEY=<RS256 PEM private key>      # RS256 for production
JWT_PUBLIC_KEY=<RS256 PEM public key>
JWT_ACCESS_EXPIRES_IN=900                    # 15 minutes (seconds)
JWT_REFRESH_EXPIRES_IN=604800               # 7 days (seconds)

# ────────────────────────────────────────────────
# MOOLRE PAYMENT GATEWAY
# ────────────────────────────────────────────────
MOOLRE_API_URL=https://api.moolre.com/v1
MOOLRE_API_KEY=moolre_live_key_...
MOOLRE_WEBHOOK_SECRET=whsec_...

# ────────────────────────────────────────────────
# SMS PROVIDER (Twilio / Africa's Talking)
# ────────────────────────────────────────────────
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+12345678900

# ────────────────────────────────────────────────
# EMAIL (Resend / Postmark)
# ────────────────────────────────────────────────
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@dispatchpay.com

# ────────────────────────────────────────────────
# MONITORING (Sentry)
# ────────────────────────────────────────────────
SENTRY_DSN=https://xxx@oyyy.ingest.sentry.io/zzz

# ────────────────────────────────────────────────
# SECURITY
# ────────────────────────────────────────────────
CORS_ALLOWED_ORIGINS=https://dashboard.dispatchpay.com,https://app.dispatchpay.com
COOKIE_DOMAIN=.dispatchpay.com
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

### Frontend Apps (Netlify)

Netlify only receives non-secret public config via build-time environment variables (prefixed `VITE_`):

```bash
# business-web
VITE_API_BASE_URL=https://api.dispatchpay.com
VITE_SENTRY_DSN=https://xxx@oyyy.ingest.sentry.io/aaa
VITE_APP_VERSION=$npm_package_version

# rider-pwa
VITE_API_BASE_URL=https://api.dispatchpay.com
VITE_VAPID_PUBLIC_KEY=BNxx...  # Web Push notification public key
```

> **Rule**: Never place private keys, JWT secrets, or Moolre API keys in `VITE_*` variables. They are baked into the client-side bundle and fully visible in browser DevTools.

---

## 4. Secrets Management

### Tiered Secrets Strategy

| Secret Type | Storage | Rotation Policy |
| :--- | :--- | :--- |
| Render env vars | Render Dashboard → Environment tab | Manual; rotate on staff departure |
| Turso auth token | Render secret env + Turso Dashboard | Every 90 days or on breach |
| JWT signing keys (RS256) | Render secret env | Every 180 days; deploy with overlap window |
| Moolre API key | Render secret env | Per Moolre vendor policy |
| Webhook secret | Render secret env | On each Moolre integration re-key |
| Upstash token | Render secret env | Every 90 days |

### GitHub Actions Secrets
CI/CD secrets are stored in **GitHub Actions Repository Secrets** (Settings → Secrets and variables → Actions). They are never logged:

```
RENDER_API_KEY          → for render.yaml deploy triggers
RENDER_SERVICE_ID       → production backend service ID
NETLIFY_AUTH_TOKEN      → for CLI deploy
NETLIFY_SITE_ID_DASH    → dashboard site ID
NETLIFY_SITE_ID_APP     → rider app site ID
TURSO_AUTH_TOKEN        → for drizzle-kit migration runner
TURSO_DATABASE_URL      → migration target
SENTRY_AUTH_TOKEN       → for source map upload
```

---

## 5. CI/CD Pipeline

### Branch Strategy

```
main          → Auto-deploys to PRODUCTION on merge
staging       → Auto-deploys to STAGING on merge
feature/*     → Preview deploys on Netlify; no backend deploy
```

### GitHub Actions Workflow

```yaml
# .github/workflows/deploy.yml

name: DispatchPay CI/CD

on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main, staging]

jobs:
  # ─────────────────────────────────────────────
  # STAGE 1: Quality Gates (runs on all PRs)
  # ─────────────────────────────────────────────
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci

      - name: Type Check
        run: npx tsc --noEmit

      - name: Lint (zero warnings)
        run: npx eslint . --max-warnings 0

      - name: Unit Tests + Coverage
        run: npx vitest run --coverage
        env:
          NODE_ENV: test

      - name: Integration Tests
        run: npx vitest run --project integration
        env:
          NODE_ENV: test

      - name: Security Tests
        run: npx vitest run --project security
        env:
          NODE_ENV: test

  # ─────────────────────────────────────────────
  # STAGE 2: E2E (runs on main + staging push)
  # ─────────────────────────────────────────────
  e2e:
    needs: quality
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npx playwright install --with-deps chromium

      - name: Start test environment
        run: docker-compose -f docker-compose.test.yml up -d
        
      - name: Wait for services
        run: npx wait-on http://localhost:3000/health --timeout 30000

      - name: Run Critical E2E Journeys
        run: npx playwright test e2e/journeys/
        env:
          BASE_URL: http://localhost:3000

      - name: Upload report on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/

  # ─────────────────────────────────────────────
  # STAGE 3: Database Migration (main only)
  # ─────────────────────────────────────────────
  migrate:
    needs: e2e
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci

      - name: Run Drizzle Migrations
        run: npx drizzle-kit migrate
        env:
          TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}
          TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}

  # ─────────────────────────────────────────────
  # STAGE 4: Deploy Backend to Render
  # ─────────────────────────────────────────────
  deploy-backend:
    needs: migrate
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Render Deploy
        run: |
          curl -X POST \
            "https://api.render.com/v1/services/${{ secrets.RENDER_SERVICE_ID }}/deploys" \
            -H "Authorization: Bearer ${{ secrets.RENDER_API_KEY }}" \
            -H "Content-Type: application/json"

      - name: Wait for Render health check
        run: |
          npx wait-on https://api.dispatchpay.com/health \
            --timeout 120000 --interval 5000

  # ─────────────────────────────────────────────
  # STAGE 5: Deploy Frontends to Netlify
  # ─────────────────────────────────────────────
  deploy-frontend:
    needs: deploy-backend
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci

      - name: Build Business Dashboard
        run: npm run build --workspace=apps/business-web
        env:
          VITE_API_BASE_URL: https://api.dispatchpay.com

      - name: Deploy Dashboard to Netlify
        run: npx netlify-cli deploy --prod --dir=apps/business-web/dist
        env:
          NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
          NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID_DASH }}

      - name: Build Rider PWA
        run: npm run build --workspace=apps/rider-pwa
        env:
          VITE_API_BASE_URL: https://api.dispatchpay.com

      - name: Deploy Rider PWA to Netlify
        run: npx netlify-cli deploy --prod --dir=apps/rider-pwa/dist
        env:
          NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
          NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID_APP }}

      - name: Upload Sentry Source Maps
        run: npx sentry-cli releases finalize ${{ github.sha }}
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: dispatchpay
```

---

## 6. Render Configuration (`render.yaml`)

```yaml
# render.yaml (committed to repo root)

services:
  - type: web
    name: dispatchpay-api
    runtime: node
    region: frankfurt           # Closest to West Africa / EU
    plan: standard              # 512MB RAM, 0.5 CPU — scale up as needed
    buildCommand: |
      npm ci &&
      npm run build --workspace=apps/backend-api
    startCommand: node apps/backend-api/dist/index.js
    healthCheckPath: /health
    autoDeploy: false           # Triggered only by CI workflow
    envVars:
      - key: NODE_ENV
        value: production
      - key: TURSO_DATABASE_URL
        sync: false             # Injected from Render Dashboard secrets
      - key: TURSO_AUTH_TOKEN
        sync: false
      - key: JWT_PRIVATE_KEY
        sync: false
      - key: MOOLRE_API_KEY
        sync: false
      - key: MOOLRE_WEBHOOK_SECRET
        sync: false
      - key: UPSTASH_REDIS_URL
        sync: false
      - key: UPSTASH_REDIS_TOKEN
        sync: false
```

---

## 7. Netlify Configuration

```toml
# apps/business-web/netlify.toml

[build]
  command   = "npm run build"
  publish   = "dist"

[build.environment]
  NODE_VERSION = "20"

# SPA routing — all paths serve index.html
[[redirects]]
  from   = "/*"
  to     = "/index.html"
  status = 200

# Security headers
[[headers]]
  for = "/*"
  [headers.values]
    Strict-Transport-Security = "max-age=31536000; includeSubDomains; preload"
    X-Content-Type-Options    = "nosniff"
    X-Frame-Options           = "DENY"
    Referrer-Policy           = "no-referrer"
    Content-Security-Policy   = "default-src 'self'; script-src 'self'; object-src 'none'; connect-src 'self' https://api.dispatchpay.com"

# Cache static assets aggressively
[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
```

---

## 8. Health Checks

### API Health Endpoint

The `/health` endpoint checks all critical downstream connections and returns a structured response that CI, Render, and monitoring tools can interpret:

```typescript
// Response shape
GET /health

// 200 OK — all systems operational
{
  "status": "healthy",
  "version": "1.2.3",
  "commit": "a1b2c3d",
  "timestamp": "2026-07-10T13:00:00Z",
  "uptime": 86400,
  "checks": {
    "database": { "status": "up", "latencyMs": 4 },
    "redis":    { "status": "up", "latencyMs": 2 },
    "moolre":   { "status": "up", "latencyMs": 180 }
  }
}

// 503 Service Unavailable — degraded
{
  "status": "unhealthy",
  "checks": {
    "database": { "status": "down", "error": "Connection timeout" },
    "redis":    { "status": "up",   "latencyMs": 2 },
    "moolre":   { "status": "up",   "latencyMs": 180 }
  }
}
```

**Health check configuration**:
- Render performs health checks every 30 seconds against `/health`.
- If the endpoint returns `5xx` for 3 consecutive checks, Render rolls back to the previous deploy automatically.
- The check has a 10-second timeout.

---

## 9. Monitoring & Alerting

### Error Tracking — Sentry

```typescript
// Backend: @sentry/node
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.npm_package_version,
  tracesSampleRate: 0.1,        // 10% of requests for performance tracing
  profilesSampleRate: 0.05,     // 5% of traces profiled
  beforeSend(event) {
    // Strip PII before sending to Sentry
    delete event.user?.email;
    delete event.user?.ip_address;
    return event;
  },
});
```

**Alert rules configured in Sentry**:
- Any new unhandled exception → Slack `#engineering-alerts` + email
- Error rate increases > 10% in 5 minutes → PagerDuty page
- `PaymentGatewayError` or `WebhookVerificationError` → immediate page (financial risk)

### Uptime Monitoring — Better Uptime / UptimeRobot

| Monitor | URL | Check interval | Alert channel |
| :--- | :--- | :--- | :--- |
| API Health | `https://api.dispatchpay.com/health` | 60s | Slack + email |
| Business Dashboard | `https://dashboard.dispatchpay.com` | 60s | Slack + email |
| Rider PWA | `https://app.dispatchpay.com` | 60s | Slack + email |

---

## 10. Logging Strategy (Production)

### Structured JSON Logs via `pino`

```typescript
// Production logger config
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: ['req.headers.authorization', 'body.password', 'body.otpCode',
            'body.momoNumber', '*.passwordHash', '*.refreshToken'],
    censor: '[REDACTED]',
  },
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty' }    // Human-readable in dev
    : undefined,                    // Raw JSON in production (for log aggregators)
});
```

### Log Aggregation

Render streams logs to **Render Log Streams** which can forward to:
- **Datadog** / **Logtail** / **Papertrail** via Render's log streaming webhook.
- Configure a **30-day retention** policy for operational logs.
- Configure a **90-day retention** policy for financial audit logs (ledger events, payout approvals).

### What to Alert On

| Log Pattern | Severity | Action |
| :--- | :--- | :--- |
| `level=fatal` | 🔴 Critical | Immediate PagerDuty page |
| `PaymentGatewayError` | 🔴 Critical | Slack `#payments-alerts` + PagerDuty |
| `WebhookVerificationFailed` | 🔴 Critical | Slack `#security-alerts` |
| `level=error` rate > 5/min | 🟠 High | Slack `#engineering-alerts` |
| `RateLimitExceeded` spike | 🟡 Medium | Slack `#security-alerts` |

---

## 11. Production Checklist

### Pre-Deploy (one-time setup)

```
Infrastructure
[ ] Turso production database created (dispatchpay-prod)
[ ] Turso Africa replica enabled (af-south-1)
[ ] Upstash Redis production database created
[ ] Render service created with render.yaml
[ ] Netlify sites created for business-web and rider-pwa
[ ] Cloudflare proxy enabled on api.dispatchpay.com
[ ] Cloudflare WAF rules configured

Secrets
[ ] All Render environment variables populated
[ ] GitHub Actions secrets populated
[ ] Moolre webhook URL registered: https://api.dispatchpay.com/api/v1/payments/webhook
[ ] Moolre payout webhook URL registered: https://api.dispatchpay.com/api/v1/payouts/webhook
[ ] CORS origins verified: dashboard + app domain only

Security
[ ] SSL certificates active and auto-renewing (Let's Encrypt via Netlify/Cloudflare)
[ ] HSTS preload list submission initiated
[ ] CSP headers verified via securityheaders.com
[ ] Sentry DSN configured and test error received
[ ] Uptime monitors active for all 3 URLs

Database
[ ] Drizzle migrations applied to production DB
[ ] Test record created and deleted (smoke test)
[ ] Turso daily backup enabled

CI/CD
[ ] All 7 E2E journeys passing on staging
[ ] Staging deploy successful before main merge
[ ] Sentry source maps uploading correctly
```

### Pre-Launch (each deploy)

```
[ ] Staging deploy green (all CI stages passed)
[ ] Database migration tested on staging first
[ ] Health check endpoint returns 200 on staging
[ ] No Critical or High Sentry errors in last 24 hours on staging
[ ] Moolre sandbox integration smoke test passed
[ ] Rollback plan reviewed with team
```

---

## 12. Rollback Strategy

### Automatic Rollback — Render
If the `/health` endpoint returns `5xx` for 3 consecutive health checks after a deploy, Render automatically reverts to the last successful deploy image. Zero manual intervention needed for server crashes or startup failures.

### Manual Rollback — Backend
```bash
# List recent Render deploys via API
curl "https://api.render.com/v1/services/$SERVICE_ID/deploys?limit=5" \
  -H "Authorization: Bearer $RENDER_API_KEY"

# Roll back to a specific deploy ID
curl -X POST \
  "https://api.render.com/v1/deploys/$DEPLOY_ID/rollback" \
  -H "Authorization: Bearer $RENDER_API_KEY"
```

### Manual Rollback — Frontend
```bash
# Netlify keeps a full deploy history
# Roll back via CLI:
npx netlify-cli deploy --prod --dir=apps/business-web/dist \
  --site-id=$NETLIFY_SITE_ID_DASH
# Or use Netlify Dashboard → Deploys → select any past deploy → "Publish deploy"
```

### Database Migration Rollback
Drizzle ORM generates migration files in `packages/db/migrations/`. Every migration must be **backwards-compatible** (additive only — no column drops, no renames) until the corresponding code deploy has been stable for 48 hours:

```
Deploy process for schema changes:
1. Ship migration (additive: new column nullable, old column kept)
2. Deploy code that reads BOTH old and new columns
3. Monitor for 48 hours
4. Ship cleanup migration removing the old column
```

This ensures any rollback of application code still works against the current database schema.

### Rollback Decision Matrix

| Scenario | Who decides | Action |
| :--- | :--- | :--- |
| Health check fails post-deploy | Automatic | Render auto-rolls back |
| Sentry error spike > 50% increase | On-call engineer | Manual Render rollback within 5 minutes |
| Payout processing failure | Engineering lead | Manual rollback + Moolre pause + team alert |
| Database migration failure | Engineering lead | Restore Turso backup; revert code deploy |
| Security incident | Security lead | Rotate all secrets; full revert; incident report |
