# DispatchPay System Architecture Design

This document details the system architecture of **DispatchPay**, an operations and payout platform for businesses that manage their own delivery riders.

---

## 1. High-Level Architecture Diagram

The high-level architecture is designed as a hybrid edge/regional architecture optimized for low latency in user-facing components (SPA/PWA) and high data integrity for payouts and financial transactions.

```
+-------------------------------------------------------------------------------------------------+
|                                           CLIENT LAYER                                          |
|                                                                                                 |
|   +---------------------------------------+           +-------------------------------------+   |
|   |         Business Dashboard            |           |              Rider PWA              |   |
|   |      (Vite + React SPA / CDN)         |           |       (Next.js PWA / CDN)           |   |
|   +-------------------+-------------------+           +------------------+------------------+   |
|                       |                                                  |                      |
|                       +------------------------+-------------------------+                      |
|                                                | HTTPS / WSS                                    |
+------------------------------------------------|------------------------------------------------+
                                                 v
+-------------------------------------------------------------------------------------------------+
|                                        GATEWAY LAYER                                            |
|                                                                                                 |
|   +-----------------------------------------------------------------------------------------+   |
|   |                  Cloudflare (WAF, SSL termination, DDoS protection, Rate Limiting)      |   |
|   +--------------------------------------------+--------------------------------------------+   |
|                                                |                                                |
+------------------------------------------------|------------------------------------------------+
                                                 v
+-------------------------------------------------------------------------------------------------+
|                                      APPLICATION LAYER                                          |
|                                                                                                 |
|   +-----------------------------------------------------------------------------------------+   |
|   |                     Load Balancer (AWS Application Load Balancer / Fly Proxy)           |   |
|   +--------------------------------------------+--------------------------------------------+   |
|                                                |                                                |
|                                                v                                                |
|   +-----------------------------------------------------------------------------------------+   |
|   |                         Backend API Service (Node.js + Fastify / Hono)                  |   |
|   |                                                                                         |   |
|   |   +------------------+     +--------------------+     +-----------------------------+   |   |
|   |   | Auth Middleware  |     | Controller Layer   |     | External Integration        |   |   |
|   |   | (JWT, RBAC/ABAC) |     | (Zod Validation)   |     | Services (Moolre, Twilio)   |   |   |
|   |   +--------+---------+     +---------+----------+     +--------------+--------------+   |   |
|   |            |                         |                               |                      |
|   |            v                         v                               |                      |
|   |   +--------+---------+     +---------+----------+                    |                      |
|   |   | Session Store    |     | Service Layer      |<-------------------+                      |
|   |   | (Upstash Redis)  |     | (Business Logic)   |                                           |
|   |   +------------------+     +---------+----------+                                           |
|   +--------------------------------------|------------------------------------------------------+
|                                          |                                                      |
+------------------------------------------|------------------------------------------------------+
                                           v
+-------------------------------------------------------------------------------------------------+
|                                         DATA LAYER                                              |
|                                                                                                 |
|   +--------------------------------------+           +--------------------------------------+   |
|   |             Turso DB                 |           |             Turso DB                 |   |
|   |      (Primary Database - Write)      |           |        (Read Replica - Edge)         |   |
|   +------------------+-------------------+           +------------------+-------------------+   |
|                      |                                                  ^                       |
|                      +------------ Real-Time Replication ---------------+                       |
|                                                                                                 |
+-------------------------------------------------------------------------------------------------+
```

### External Integrations Diagram

```
                              +---------------------------------------+
                              |              DispatchPay              |
                              |              Backend API              |
                              +--------+--------------------+---------+
                                       |                    ^
                                       | 1. Payout request  | 3. Webhook (Success/Fail)
                                       |    (HTTPS POST)    |
                                       v                    |
                              +--------+--------------------+---------+
                              |              Moolre API               |
                              |  (African Payment/Payout Gateway)     |
                              +--------+------------------------------+
                                       |
                                       | 2. Push funds
                                       v
                              +--------+------------------------------+
                              |      Rider Mobile Money Wallet        |
                              |   (MTN / Telecel / AirtelTigo Cash)   |
                              +---------------------------------------+
```

---

## 2. Component Responsibilities

### Client Apps
*   **Business Dashboard (Web)**:
    *   Single Page Application (React + Vite) designed for desktop viewports.
    *   Provides operations monitoring, rider performance statistics, delivery tracking metrics, wallet management (funding), payout batch creation, and configuration of commissions/tariffs.
    *   Maintains local state caching via `@tanstack/react-query` to limit API requests.
*   **Rider PWA (Mobile)**:
    *   Progressive Web App built for mobile devices, optimized for low bandwidth and poor connectivity.
    *   Utilizes a local Service Worker to support offline actions (e.g., caching delivery details, logging trips offline, queueing sync actions).
    *   Interfaces with browser Geolocation APIs to track delivery coordinate updates.
    *   Enables riders to view active orders, log payouts, and request instant cash-outs to their Mobile Money (MoMo) wallets.

### Server & Database
*   **Backend API**:
    *   Fastify/Hono application using TypeScript. Serves as the single source of truth for business logic.
    *   Validates input schemas, enforces authorization/tenant segregation, generates audit logs, coordinates ledger database transactions, and manages the lifecycle of payout actions.
    *   Integrates directly with LibSQL/Turso using Drizzle ORM.
*   **Turso Database**:
    *   Distributed SQL database powered by libSQL (SQLite-compatible).
    *   Stores core transactional tables (Users, Businesses, Riders, Deliveries, Wallets, Ledgers).
    *   Replicates data globally to low-latency edge read replicas close to application instances.
*   **Upstash Redis Cache**:
    *   Provides distributed key-value storage for API rate-limiting counters, temporary authentication OTP states, and session storage.

### External Services
*   **Moolre API**:
    *   Handles financial actions: Mobile Money payouts to MTN MoMo, Telecel Cash, and AirtelTigo Cash.
    *   Acts as the processing gateway for funding the main business wallets.
    *   Dispatches webhooks to inform DispatchPay of payout completions or failures.
*   **Notification Gateway (Twilio / SMS)**:
    *   Dispatches OTP text messages to riders during registration, login, and payout verification steps.

---

## 3. Folder Structure (Monorepo)

DispatchPay uses a TypeScript monorepo setup configured via npm workspaces.

```
/
├── package.json                    # Monorepo configuration and scripts
├── tsconfig.json                   # Base TypeScript config
├── .gitignore                      # Git ignore configurations
│
├── apps/                           # Executable Applications
│   ├── backend-api/                # Fastify/Hono Backend API
│   │   ├── src/
│   │   │   ├── config/             # DB & API setup, env variables
│   │   │   ├── controllers/        # Request handlers & Zod validation
│   │   │   ├── middleware/         # Auth, RBAC, Rate-limits, Errors
│   │   │   ├── services/           # Payout orchestration, ledger, Moolre, SMS
│   │   │   ├── repositories/       # Database interface methods (Drizzle queries)
│   │   │   ├── webhooks/           # Webhook receiver endpoints
│   │   │   └── index.ts            # Entrypoint
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── business-web/               # Business Dashboard SPA
│   │   ├── src/
│   │   │   ├── components/         # Shared dashboard UI units
│   │   │   ├── context/            # Auth & UI contexts
│   │   │   ├── hooks/              # API hooks via TanStack Query
│   │   │   ├── pages/              # Routes (Dashboard, Riders, Wallets)
│   │   │   ├── services/           # Axios instance with interceptors
│   │   │   └── main.tsx            # React entry
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── rider-pwa/                  # Rider Progressive Web App
│       ├── public/                 # PWA icons, manifest.json
│       ├── src/
│       │   ├── components/         # Mobile UI widgets, sheets
│       │   ├── hooks/              # Geolocation, offline sync
│       │   ├── pages/              # Mobile screens (Home, Wallet, Cashout)
│       │   └── main.tsx
│       ├── vite.config.ts          # Vite configuration with PWA plugin
│       └── package.json
│
├── packages/                       # Shared Library Modules
│   ├── config/                     # Shared tooling configs (ESLint, TS)
│   ├── db/                         # Drizzle schemas, migrations, LibSQL client
│   │   ├── src/
│   │   │   ├── schema/             # Schema definitions (drizzle-orm)
│   │   │   ├── migrations/         # Auto-generated migrations
│   │   │   └── client.ts           # Shared Turso connection initialization
│   │   └── package.json
│   │
│   ├── types/                      # Shared TS Types & API Interfaces
│   │   ├── src/
│   │   │   ├── api.ts              # API Request/Response TS interfaces
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── ui/                         # Atomic Design UI Components
│       ├── src/
│       │   ├── components/         # Buttons, Inputs, Dialogs, Tooltips
│       │   └── index.ts
│       └── package.json
│
└── docs/                           # Project documentation
    ├── 01-product/
    ├── 02-design/
    │   └── architecture.md         # This architectural specification
    ├── 03-ui/
    └── 04-development/
```

---

## 4. Request Lifecycle

The request lifecycle guarantees input safety, database integrity, audit tracking, and asynchronous payment orchestration.

```
[ Rider PWA ]               [ Backend API Router ]        [ Auth & RBAC ]           [ Service & Ledger ]       [ Turso DB ]
      |                             |                            |                            |                     |
      |--- 1. POST /payouts ------->|                            |                            |                     |
      |    (Access Token + Payload) |                            |                            |                     |
      |                             |--- 2. Validate JWT ------->|                            |                     |
      |                             |<-- 3. Return Rider Context |                            |                     |
      |                             |                                                         |                     |
      |                             |--- 4. Execute Business Checks (Check wallet balance) -->|                     |
      |                             |                                                         |--- 5. Start Tx ---->|
      |                             |                                                         |    Lock Balance     |
      |                             |                                                         |                     |
      |                             |                                                         |<-- 6. Tx Success ---|
      |                             |                                                         |                     |
      |                             |--- 7. Orchestrate Payout (Call Moolre API Async) ------>|                     |
      |                             |<-- 8. Return PENDING Payout Transaction ID -------------|                     |
      |                             |                                                         |                     |
      |<-- 9. 202 Accepted ---------|                                                         |                     |
      |    (Tracking ID)            |                                                         |                     |
```

### Detailed Phases
1.  **Transport & Security**: The client initiates an HTTPS request. Cloudflare decrypts TLS, inspects request metrics (WAF rules), and checks IP rate limits.
2.  **Routing & Middleware Validation**: The Backend API routes the request through a pipeline:
    *   **Logging Middleware**: Generates a unique `Correlation-ID` (`X-Request-ID`) and records incoming route metrics.
    *   **Auth Middleware**: Extracts the Bearer token from the `Authorization` header, decrypts it, checks expiration, and retrieves user identity context.
    *   **Authorization Middleware**: Checks the user's role (e.g., must be a `Rider`) and performs context validation (e.g., checking if the Rider is active).
3.  **Input Schema Validation**: The controller intercepts the payload and validates it using a pre-defined **Zod Schema**. If validation fails, it short-circuits the request and returns a `400 Bad Request` containing structured field-level errors.
4.  **Transaction Processing (Service Layer)**:
    *   **Ledger Debit Operation**: The service establishes a database transaction block inside Turso DB. It locks the rider's wallet balance, verifies funding availability, and posts a `DEBIT` ledger entry marked as `PENDING`.
    *   **External Dispatch**: The service sends an asynchronous API request to the Moolre payout system, supplying an idempotency key derived from the local transaction tracking ID.
5.  **Response Delivery**: The API updates the transaction status in Turso to include the Moolre tracking reference, commits the local DB transaction, and returns a `202 Accepted` status with the transaction tracking token to the PWA.
6.  **Outbound Webhook Reconciliation**: Moolre completes the payout asynchronously and posts an authenticated webhook event to the Backend API. The API updates the database record state to `SUCCESS` or `FAILED` (reverting the wallet balance if failed), and sends a push notification to the rider's PWA.

---

## 5. Authentication Flow

Authentication uses standard JWTs combined with mobile OTP for riders and credentials/MFA for business admins.

```
Rider Client                 Backend API                  Turso DB                 SMS Gateway
    |                             |                          |                          |
    |--- 1. POST /auth/otp ------>|                          |                          |
    |    (Phone number)           |--- 2. Fetch User Record ->|                          |
    |                             |<-- 3. Return User Data --|                          |
    |                             |                                                     |
    |                             |--- 4. Gen & Save OTP (Redis) ---------------------->|
    |                             |                                                     | Send SMS OTP
    |                             |<-- 5. Return OTP ID Reference ----------------------| to Mobile
    |<-- 6. OTP Sent (200 OK) ----|                                                     v
    |                             |
    |                             |
    |--- 7. POST /auth/verify --->|
    |    (Phone + OTP Code)       |--- 8. Match OTP code in Redis
    |                             |--- 9. Issue JWT Pair (Access + Refresh)
    |<-- 10. Tokens (Set-Cookie) -|
```

### Authentication Architecture Details
*   **Identity Types**:
    *   **Business Users**: Authenticate using email and password. Protected by Multi-Factor Authentication (MFA) via TOTP (e.g., Google Authenticator).
    *   **Riders**: Authenticate using passwordless Phone Number + SMS OTP, followed by local device PIN/Biometrics for fast subsequent access.
*   **Token Lifecycle**:
    *   **Access Token**: Short-lived (15 minutes), payload-encoded JWT containing User ID, Role, Tenant ID (`business_id`), and permissions scope.
    *   **Refresh Token**: Long-lived (7 days), stored in the database, matching client device footprints. Rotated on reuse to prevent reuse attacks.
*   **Cookie Security Configuration**:
    *   Tokens are delivered via `HttpOnly`, `Secure`, `SameSite=Strict` cookies to block Cross-Site Scripting (XSS) and cross-site request forgery (CSRF) vectors.

---

## 6. Authorization Strategy

DispatchPay uses a strict combined Role-Based Access Control (RBAC) and Attribute-Based Access Control (ABAC) matrix to guarantee tenant isolation and operation restriction.

### Role Hierarchy
*   **SuperAdmin**: Global system support. Access to multi-tenant monitoring, manual webhook triggers, configuration of platform-wide processing tariffs.
*   **BusinessOwner**: Full management capabilities inside their business scope. Can fund wallets, view audit logs, adjust commissions, configure payout rules, and modify managers and riders.
*   **BusinessManager**: Operational support. Can view dashboards, approve ride routes, assign tasks, and trigger manual cash-out releases (but cannot modify bank accounts or billing parameters).
*   **Rider**: Mobile access only. Can view assigned deliveries, update coordinates, view their personal ledger, and trigger payouts to their own validated phone number.

### Tenant Isolation (ABAC Pattern)
All database tables mapping to operations contain a `business_id` partition column. Every database query executed by the API is scoped through the user identity context.
*   Example query middleware logic:
    ```sql
    SELECT * FROM riders WHERE id = :riderId AND business_id = :authenticatedUserBusinessId;
    ```
*   Ensures that even if an API endpoint accepts an arbitrary `riderId`, a business manager cannot retrieve information or execute actions on a rider belonging to a competitor business.

---

## 7. API Communication Flow

The API layer is built on RESTful principles with JSON payloads, leveraging HTTP status codes and strict schema contracts.

### Protocol Standards
*   **API Protocol**: REST over HTTPS.
*   **Media Type**: `application/json`.
*   **Input Validation**: Zod parsing middleware inside controllers.
*   **Output Serialization**: Fastify-json-stringify to optimize performance and prevent accidentally leaking sensitive schema fields (e.g., password hashes).

### Real-Time Pipeline
*   **Protocol**: WebSockets (using `ws` library or Socket.io) or Server-Sent Events (SSE).
*   **Use Cases**:
    *   Real-time location sharing of active riders sent from Rider PWA to the backend.
    *   Live delivery assignment alerts sent from the backend to the Rider PWA.
    *   Dynamic dashboard metric updates on the Business Dashboard.

### External API Communication (Moolre)
*   **Security**: Authentication via encrypted Request Signatures (`X-Moolre-Signature`) matching payload hashes, accompanied by bearer API tokens.
*   **Resiliency**:
    *   **Idempotency Keys**: Passed on every payout request (`Idempotency-Key: <tx_uuid>`) to prevent duplicate payouts in case of transient network timeouts.
    *   **Circuit Breakers**: Implemented using libraries like `cockatiel` to throttle outbound requests if Moolre's endpoint returns consecutive HTTP 500s.

---

## 8. Error Handling Strategy

Errors are treated as first-class citizens in DispatchPay. Client apps receive structured error data conforming to the **RFC 7807 (Problem Details for HTTP APIs)** standard.

### Standardized Error Payloads
Whenever an operation fails, the API returns a structured response matching this format:
```json
{
  "type": "https://api.dispatchpay.com/errors/insufficient-funds",
  "title": "Insufficient Wallet Balance",
  "status": 402,
  "detail": "The business wallet does not have enough balance to cover the requested payout of 500 GHS plus transaction fees.",
  "instance": "/payouts/tx_987654321",
  "code": "INSUFFICIENT_FUNDS",
  "invalid_params": []
}
```

### Validation Error Pattern (HTTP 400)
```json
{
  "type": "https://api.dispatchpay.com/errors/validation-failed",
  "title": "Validation Failed",
  "status": 400,
  "detail": "One or more request parameters failed validation checks.",
  "instance": "/riders/register",
  "code": "VALIDATION_FAILED",
  "invalid_params": [
    {
      "name": "phone_number",
      "reason": "Phone number must be in E.164 international format (e.g., +233240000000)."
    }
  ]
}
```

### Error Classification Matrix
*   `AppError` (Abstract Base Class)
    *   `ValidationError` (400 Bad Request)
    *   `AuthenticationError` (401 Unauthorized)
    *   `AuthorizationError` (403 Forbidden)
    *   `ResourceNotFoundError` (404 Not Found)
    *   `BusinessRuleError` (422 Unprocessable Entity - e.g., payout during locked hours)
    *   `PaymentGatewayError` (502 Bad Gateway - Moolre integration failure)
    *   `SystemError` (500 Internal Server Error)

### Recovery & Webhook Failures
If a webhook from Moolre fails to deliver or processing fails (e.g., due to database locks), the API returns a `503 Service Unavailable` or `500 Internal Server Error` response. This triggers Moolre's webhook retry policy (which uses exponential backoff over 24 hours).

---

## 9. Logging Strategy

Logs provide complete observability into the state of the platform, financial ledger consistency, and API system performance.

### Log Standards
*   **Formatter**: Structured JSON logs using `pino` (Node.js) or `winston`.
*   **Correlation ID**: Every request gets a generated `Correlation-ID` (`X-Request-ID`) and records incoming route metrics.
*   **Data Masking**: High-risk fields (passwords, JWTs, credit card tokens, full bank accounts, OTP tokens) are scrubbed at the logger library boundary via regular expression schemas.

### Log Levels
*   `FATAL`: Critical system crashes (e.g., unable to bind server port, lost database connection pool).
*   `ERROR`: Managed failures requiring operations triage (e.g., outbound Moolre API payload mismatch, database migration fails).
*   `WARN`: Actionable anomalies that do not crash requests (e.g., rate limit triggers, verification code retry threshold reached).
*   `INFO`: High-level operational events (e.g., payout initiated, rider registered, webhook status update received).
*   `DEBUG`: Low-level tracing information (e.g., DB query executions, incoming HTTP request payload structures).

### Ledger Audit Log Pattern
Financial transactions write an audit-compliant log footprint to the logging pipeline:
```json
{
  "level": 30, // INFO
  "time": 1783687071000,
  "msg": "Ledger entry created successfully",
  "correlationId": "req-8c9df8a-b92c",
  "context": {
    "businessId": "biz_12345",
    "riderId": "rider_67890",
    "amount": 150.00,
    "currency": "GHS",
    "transactionId": "tx_abc123xyz",
    "action": "LEDGER_DEBIT",
    "previousBalance": 450.00,
    "newBalance": 300.00
  }
}
```

---

## 10. Deployment Architecture

DispatchPay uses a scalable cloud architecture with CDN caching at the edge, multi-region API compute close to user clusters, and a globally distributed, replication-active database.

### Topology Overview
```
                     +---------------------------------------+
                     |             Cloudflare CDN            |
                     |         (Edge Static Assets)          |
                     +---+-------------------------------+---+
                         |                               |
                         v (Static HTML/JS)              v (Dynamic API calls)
             +-----------+-----------+       +-----------+-----------+
             |      Vercel Edge      |       |      Fly.io / AWS     |
             |  (Business & Rider FE) |       |   (Backend API nodes) |
             +-----------------------+       +-----+-----+-----+-----+
                                                   |     |     |
                         +-------------------------+     |     +-------------------------+
                         |                               v                               |
                         v (Low-latency libSQL)          v (Low-latency libSQL)          v (Low-latency libSQL)
             +-----------+-----------+       +-----------+-----------+       +-----------+-----------+
             |    Turso DB Replica   |       |    Turso DB Primary   |       |    Turso DB Replica   |
             |       (West Europe)   |       |      (North America)  |       |     (West Africa)     |
             +-----------------------+       +-----------------------+       +-----------------------+
```

### Hosting Environments
*   **Frontends (Business & Rider)**: Deployed on Vercel or Cloudflare Pages. Delivers rapid page load times via global edge caching of compiled assets.
*   **Backend API**: Hosted on Fly.io (deployed in Docker containers across regional nodes like Amsterdam and Johannesburg) or AWS ECS Fargate, scaling automatically based on request CPU and memory usage.
*   **Database (Turso)**: Hosted on Turso's edge platform. The primary write node is placed in the primary application region (e.g., EU-West or US-East), with read replicas running in regions matching the target audience footprint (e.g., Africa-South - Johannesburg).

### CI/CD Deployment Process
1.  **Code Check-In**: Developers merge features to `main` branch.
2.  **Lint & Test Runner (GitHub Actions)**:
    *   Triggers automated linters (`eslint`), type checkers (`tsc`), and test suites (Vitest/Jest).
3.  **Docker Build & Scan**:
    *   Compiles typescript to javascript.
    *   Builds a lightweight production container using a multi-stage Dockerfile based on `node:alpine`.
    *   Pushes the built container to a private registry (AWS ECR or Fly registry).
4.  **Database Migration Runner**:
    *   Runs migrations against the primary Turso database instance using `drizzle-kit migrate`.
5.  **Compute Rollout (Green-Blue / Rolling Update)**:
    *   Updates the backend service. Performs health checks on new instances before shutting down old instances, ensuring zero-downtime updates.
6.  **Edge Invalidation**:
    *   Purges static content caches on Vercel and Cloudflare for the frontend applications.
