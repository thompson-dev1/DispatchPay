# DispatchPay Authentication & Authorization Design

This document specifies the secure authentication and authorization architecture for **DispatchPay**. It details session management, route protection, token lifecycles, and security controls.

---

## 1. Folder Structure (Authentication Module)

The authentication components are partitioned between the shared library (types/validations) and the Backend API service:

```
/
├── apps/
│   └── backend-api/
│       └── src/
│           ├── controllers/
│           │   └── auth.controller.ts     # Handles register, login, refresh, logout, reset
│           │
│           ├── middleware/
│           │   ├── auth.middleware.ts     # JWT extraction and validation
│           │   ├── rbac.middleware.ts     # Role-Based access enforcement
│           │   └── rate-limit.middleware.ts # Throttling for sensitive endpoints
│           │
│           ├── services/
│           │   ├── auth.service.ts        # Business logic: token generation, hashing, checks
│           │   ├── sms.service.ts         # Dispatches OTP SMS verification
│           │   └── email.service.ts       # Dispatches password reset emails
│           │
│           └── repositories/
│               ├── user.repository.ts     # Queries for user credentials & statuses
│               └── session.repository.ts  # Persists and rotates refresh tokens
│
└── packages/
    └── types/
        └── src/
            └── validation/
                └── auth.schema.ts         # Zod schemas for incoming auth payloads
```

---

## 2. API Endpoints

All authentication endpoints are prefixed with `/api/v1/auth` and rate-limited.

| HTTP Method | Route | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| **POST** | `/auth/business/register` | No | Registers a new Business account along with its first `BUSINESS_OWNER` user. |
| **POST** | `/auth/business/login` | No | Authenticates business users using email/password. Returns JWTs. |
| **POST** | `/auth/rider/register` | No | Registers a new Rider profile associated with a specific Business. |
| **POST** | `/auth/rider/login-otp` | No | Triggers a 6-digit numeric SMS verification code to the rider's phone. |
| **POST** | `/auth/rider/verify-otp` | No | Validates the SMS OTP and issues the JWT pair. |
| **POST** | `/auth/refresh` | Yes (Cookie) | Validates the HTTP-Only refresh cookie, rotates the token, and issues a new access token. |
| **POST** | `/auth/logout` | Yes | Revokes the current refresh session and clears the cookie. |
| **POST** | `/auth/password/reset-request` | No | Generates a secure, short-lived reset token and sends it via email (or SMS). |
| **POST** | `/auth/password/reset` | No | Consumes the token and updates the user's password. |

---

## 3. Middleware Architecture

Auth routing uses a pipeline of Fastify/Hono hook middlewares to protect endpoints:

```
[ Request ] 
    │
    ▼
[ Rate Limiter Middleware ] ── (Throttle endpoints like /login or /verify-otp)
    │
    ▼
[ Auth Middleware ] ────────── (Extract Cookie/Header, verify JWT, bind req.user)
    │
    ▼
[ RBAC Middleware ] ────────── (Check user.role against allowed roles)
    │
    ▼
[ Tenant Middleware ] ──────── (Validate req.user.businessId matches route resource businessId)
    │
    ▼
[ Request Handler (Controller) ]
```

### Auth Middleware Core Logic
1.  **Extraction**: Extracts the access token from the `Authorization: Bearer <token>` header or a secure cookie.
2.  **Verification**: Verifies the signature using the HS256 secret or RS256 public key.
3.  **Active Session Validation**: Checks if the user's `is_active` state is true in the database (or cached in Redis) to prevent disabled users from using unexpired JWTs.
4.  **Binding**: Attaches the token payload to the request context:
    ```typescript
    interface RequestContextUser {
      id: string;
      role: 'SUPER_ADMIN' | 'BUSINESS_OWNER' | 'BUSINESS_MANAGER' | 'RIDER';
      businessId: string | null;
    }
    ```

### RBAC Middleware Core Logic
Wraps controller routes dynamically:
```typescript
export const requireRoles = (allowedRoles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      throw new ForbiddenError("You do not have permission to access this resource.");
    }
    next();
  };
};
```

---

## 4. Token Lifecycle & Storage

To defend against intercept attacks and theft, DispatchPay token handling is structured as follows:

```
+------------------+-----------------------------+-----------------------------+------------------------------------+
| Token Type       | Lifespan                    | Transport mechanism         | Client-Side Storage Location       |
+------------------+-----------------------------+-----------------------------+------------------------------------+
| Access Token     | 15 Minutes                  | Authorization Header        | Memory (React Context/State variable)|
|                  |                             | (Bearer JWT)                | *Never stored in LocalStorage*     |
+------------------+-----------------------------+-----------------------------+------------------------------------+
| Refresh Token    | 7 Days                      | HTTP-Only secure Cookie     | Browser secure cookie vault        |
|                  |                             | Path=/api/v1/auth/refresh   | (Inaccessible to JS scripts)       |
+------------------+-----------------------------+-----------------------------+------------------------------------+
```

---

## 5. Refresh Strategy (Token Rotation)

We implement **Refresh Token Rotation (RTR)** to prevent session hijacking. Each time a client requests a new Access Token using their Refresh Token:
1.  The client sends the Refresh Token cookie.
2.  The server verifies the token signature and queries the `refresh_tokens` database table using the token's SHA-256 hash.
3.  **Normal Flow**:
    *   If the token is valid and active, the server generates a **new Access Token** and a **new Refresh Token**.
    *   The old Refresh Token is marked as `used`/`revoked`.
    *   The new Refresh Token is returned as a cookie, and the new Access Token is returned in the JSON response payload.
4.  **Token Abuse Detection (Replay Protection)**:
    *   If the database check reveals the token has **already been used**, it indicates a replay attack (either the client or an attacker is reusing a token).
    *   **Action**: The server instantly invalidates the entire session family tree (all active sessions and refresh tokens associated with that `user_id`). This logs out both the legitimate user and the attacker, forcing a fresh credentials re-authentication.

```
       Client                           Backend API                          Turso DB
          |                                  |                                  |
          |---- 1. POST /auth/refresh ------>|                                  |
          |    (Refresh Cookie token_v1)     |---- 2. Query token_v1 hash ----->|
          |                                  |<--- 3. Return: Valid, Unused ----|
          |                                  |                                  |
          |                                  |---- 4. Mark token_v1 as used --->|
          |                                  |---- 5. Insert new token_v2 ------>|
          |                                  |                                  |
          |<--- 6. Return new access token --|                                  |
          |    & Set-Cookie (token_v2)       |                                  |
```

---

## 6. Password Reset Strategy

For security, password resets avoid sending passwords or storing plain-text keys:
1.  **Request Generation**: The user enters their email. The server creates a cryptographically secure random token (`crypto.randomBytes(32).toString('hex')`).
2.  **Hashing**: The server hashes this token using SHA-256 and stores it in the database (`password_reset_tokens` table) with an expiration timestamp set to 1 hour, bound to the `user_id`.
3.  **Delivery**: The server sends a URL to the user's registered email: `https://dashboard.dispatchpay.com/reset-password?token=<plain_text_token>`.
4.  **Consumption**: 
    *   The user submits their new password along with the `<plain_text_token>`.
    *   The server hashes the submitted token using SHA-256 and looks up the record.
    *   If found, valid, and not expired, the server hashes the new password, updates the user's password record, deletes the reset token record, and invalidates all active sessions (forcing re-login).

---

## 7. Security Best Practices & Rationale

### Hashing Algorithms
*   **Decision**: Use **Argon2id** (via native Node.js bindings or `@node-rs/argon2`) for password hashing.
*   **Rationale**: Argon2id is the winner of the Password Hashing Competition. It is highly resistant to GPU/ASIC brute-force attacks due to configurable memory-hardness and time-hardness parameters, outperforming older algorithms like BCrypt and SHA-256.

### Rate Limiting (Brute-Force Mitigation)
*   **Decision**: Apply strict rate limiting on `/auth/business/login` (maximum 5 requests per 15 minutes per IP) and `/auth/rider/verify-otp` (maximum 3 requests per 15 minutes per phone number).
*   **Rationale**: Thwarts dictionary attacks and automated OTP cracking scripts.

### XSS & CSRF Mitigation
*   **Decision**: Access tokens are kept in JavaScript memory only. Refresh tokens use cookies with:
    *   `HttpOnly`: Prevents client-side scripts from reading the token (mitigates XSS extraction).
    *   `Secure`: Ensures cookies are only transmitted over TLS (HTTPS).
    *   `SameSite=Strict`: Restricts cookie transmission to first-party requests only (mitigates CSRF).
*   **Rationale**: Avoids local storage vulnerability where XSS exploits can read JWT payloads.

### SMS OTP Security
*   **Decision**: Rider OTPs are strictly 6 digits, expire after 5 minutes, and are stored hashed inside Upstash Redis with a maximum validation retry threshold of 3 attempts.
*   **Rationale**: 6 digits prevent easy guessing, while the short TTL and validation threshold prevent fast brute-force enumeration tools from discovering the correct code.
