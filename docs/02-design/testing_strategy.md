# DispatchPay Testing Strategy

This document defines the complete testing strategy for **DispatchPay** across all application layers. Every test category maps directly to a business risk — if a test category is skipped, the associated risk is accepted explicitly.

---

## 1. Testing Philosophy

**The Testing Trophy** (adapted for a financial platform):

```
                     ╔═══════════════════════════╗
                     ║   E2E Tests (Critical Journeys)   ║  ← Small. Expensive. High-value.
                     ╠═══════════════════════════╣
                     ║     Integration Tests      ║  ← Medium. Service boundaries.
                     ╠═══════════════════════════╣
                     ║       Unit Tests           ║  ← Large. Fast. Isolated.
                     ╠═══════════════════════════╣
                     ║    Static Analysis (TS + ESLint)  ║  ← Free. Always on.
                     ╚═══════════════════════════╝
```

**Core rules**:
- Unit tests cover **pure business logic** (commission calculations, state machine transitions, error classifications).
- Integration tests cover **service boundaries** (API ↔ Database, API ↔ Moolre, API ↔ Redis).
- E2E tests cover only the **critical user journeys that must never fail** — kept small and reliable.
- All financial mutation paths have dedicated **payment safety tests** that verify atomicity and idempotency.

---

## 2. Technology Stack

### Backend Testing
| Library | Purpose |
| :--- | :--- |
| **Vitest** | Unit and integration test runner. ES-module native, very fast, Vite-compatible |
| **Supertest** | HTTP integration tests against the Fastify server instance |
| **@libsql/client** (in-memory) | Turso test database — spins up a fresh in-memory SQLite DB per test suite |
| **msw (Mock Service Worker)** | Intercepts outbound HTTP calls to Moolre API in integration tests |
| **faker.js** | Generates realistic test fixtures (phone numbers, addresses, amounts) |
| **drizzle-kit** | Runs migrations against the in-memory test database |

### Frontend Testing
| Library | Purpose |
| :--- | :--- |
| **Vitest + jsdom** | Component unit tests |
| **React Testing Library** | Component integration tests; user-event based |
| **msw** | Intercepts API calls from frontend components during tests |
| **Playwright** | E2E browser tests across Chrome (Android) and Chromium (desktop) |

### Security Testing
| Library | Purpose |
| :--- | :--- |
| **OWASP ZAP (CLI)** | Automated vulnerability scan against staging API |
| **zod-to-openapi + Spectral** | Validates API schema conformance and security rules |

---

## 3. Project Test Structure

```
/
├── apps/
│   ├── backend-api/
│   │   └── src/
│   │       ├── __tests__/
│   │       │   ├── unit/
│   │       │   │   ├── services/
│   │       │   │   │   ├── auth.service.test.ts
│   │       │   │   │   ├── payout.service.test.ts
│   │       │   │   │   └── delivery.service.test.ts
│   │       │   │   └── middleware/
│   │       │   │       ├── auth.middleware.test.ts
│   │       │   │       └── rbac.middleware.test.ts
│   │       │   │
│   │       │   ├── integration/
│   │       │   │   ├── auth.routes.test.ts
│   │       │   │   ├── deliveries.routes.test.ts
│   │       │   │   ├── payouts.routes.test.ts
│   │       │   │   ├── payments.webhook.test.ts
│   │       │   │   └── riders.routes.test.ts
│   │       │   │
│   │       │   └── helpers/
│   │       │       ├── test-db.ts         # In-memory DB setup/teardown
│   │       │       ├── test-server.ts     # Fastify server factory for tests
│   │       │       └── fixtures.ts        # faker.js factories
│   │       │
│   │       └── vitest.config.ts
│   │
│   ├── business-web/
│   │   └── src/
│   │       └── __tests__/
│   │           ├── unit/
│   │           │   └── hooks/
│   │           │       └── use-deliveries.test.ts
│   │           └── integration/
│   │               └── create-delivery.test.tsx
│   │
│   └── rider-pwa/
│       └── src/
│           └── __tests__/
│               ├── unit/
│               │   └── otp-input.test.tsx
│               └── integration/
│                   └── job-status-slider.test.tsx
│
└── e2e/                              # Playwright E2E (monorepo root level)
    ├── journeys/
    │   ├── business-register.spec.ts
    │   ├── rider-login-otp.spec.ts
    │   ├── create-dispatch-delivery.spec.ts
    │   ├── rider-complete-delivery.spec.ts
    │   └── rider-cashout.spec.ts
    ├── fixtures/
    │   └── global-setup.ts           # Seed test business + rider accounts
    └── playwright.config.ts
```

---

## 4. Unit Tests

Unit tests are isolated, fast, and have **zero external dependencies** (no DB, no network, no filesystem).

### 4.1 Auth Service — Password Hashing

```typescript
// apps/backend-api/src/__tests__/unit/services/auth.service.test.ts

describe('AuthService.hashPassword', () => {
  it('produces a valid Argon2id hash', async () => {
    const hash = await authService.hashPassword('SecurePassword123!');
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('two different calls produce different hashes (salting)', async () => {
    const h1 = await authService.hashPassword('password');
    const h2 = await authService.hashPassword('password');
    expect(h1).not.toBe(h2);
  });

  it('verifyPassword returns true for matching credentials', async () => {
    const hash = await authService.hashPassword('correct');
    expect(await authService.verifyPassword('correct', hash)).toBe(true);
  });

  it('verifyPassword returns false for wrong password', async () => {
    const hash = await authService.hashPassword('correct');
    expect(await authService.verifyPassword('wrong', hash)).toBe(false);
  });
});
```

### 4.2 Delivery State Machine — Valid/Invalid Transitions

```typescript
// apps/backend-api/src/__tests__/unit/services/delivery.service.test.ts

describe('DeliveryService.validateStatusTransition', () => {
  const validTransitions = [
    ['PENDING',    'ASSIGNED'],
    ['ASSIGNED',   'PICKED_UP'],
    ['PICKED_UP',  'DELIVERED'],
    ['ASSIGNED',   'CANCELLED'],
    ['PENDING',    'CANCELLED'],
  ];

  it.each(validTransitions)(
    'allows transition from %s to %s',
    (from, to) => {
      expect(() => validateStatusTransition(from, to)).not.toThrow();
    }
  );

  const invalidTransitions = [
    ['PENDING',   'PICKED_UP'],   // Cannot skip ASSIGNED
    ['PENDING',   'DELIVERED'],   // Cannot skip multiple states
    ['DELIVERED', 'ASSIGNED'],    // Cannot go backwards
    ['CANCELLED', 'ASSIGNED'],    // Cannot revive a cancelled delivery
  ];

  it.each(invalidTransitions)(
    'rejects invalid transition from %s to %s',
    (from, to) => {
      expect(() => validateStatusTransition(from, to))
        .toThrow(BusinessRuleError);
    }
  );
});
```

### 4.3 Commission Calculation

```typescript
describe('DeliveryService.calculateSplit', () => {
  it('rider payout = fee - commission', () => {
    const result = calculateSplit({ feeMinor: 5000, commissionMinor: 1000 });
    expect(result.payoutMinor).toBe(4000);
  });

  it('throws if commission exceeds fee', () => {
    expect(() => calculateSplit({ feeMinor: 1000, commissionMinor: 1500 }))
      .toThrow(ValidationError);
  });

  it('throws if fee is zero or negative', () => {
    expect(() => calculateSplit({ feeMinor: 0, commissionMinor: 0 }))
      .toThrow(ValidationError);
  });
});
```

### 4.4 RBAC Middleware

```typescript
describe('requireRoles middleware', () => {
  it('allows request when role is in allowed list', async () => {
    const req = mockRequest({ user: { role: 'BUSINESS_OWNER' } });
    const next = vi.fn();
    await requireRoles(['BUSINESS_OWNER', 'BUSINESS_MANAGER'])(req, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  it('throws ForbiddenError when role is not in allowed list', async () => {
    const req = mockRequest({ user: { role: 'RIDER' } });
    await expect(requireRoles(['BUSINESS_OWNER'])(req, mockRes, vi.fn()))
      .rejects.toThrow(ForbiddenError);
  });

  it('throws AuthenticationError when no user context', async () => {
    const req = mockRequest({ user: null });
    await expect(requireRoles(['BUSINESS_OWNER'])(req, mockRes, vi.fn()))
      .rejects.toThrow(AuthenticationError);
  });
});
```

---

## 5. Integration Tests

Integration tests wire the real Fastify server against an in-memory Turso DB, with Moolre API calls intercepted by `msw`.

### 5.1 Test Setup Pattern

```typescript
// apps/backend-api/src/__tests__/helpers/test-db.ts

export const createTestDatabase = async () => {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: '../../../packages/db/migrations' });
  return { db, client };
};

// Each test suite gets a fresh DB; each test runs in a transaction that is rolled back
beforeEach(async () => { await db.run(sql`BEGIN`) });
afterEach(async  () => { await db.run(sql`ROLLBACK`) });
```

### 5.2 Auth Routes — Business Registration & Login

```typescript
// apps/backend-api/src/__tests__/integration/auth.routes.test.ts

describe('POST /auth/business/register', () => {
  it('creates business + owner user and returns 201', async () => {
    const res = await request(app).post('/api/v1/auth/business/register').send({
      businessName: 'Test Co',
      businessEmail: 'co@test.com',
      adminEmail: 'admin@test.com',
      adminPassword: 'SecurePass123!',
      adminName: 'Test Admin',
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('businessId');
    expect(res.body).toHaveProperty('userId');
  });

  it('returns 409 if email already registered', async () => {
    await seedBusiness({ adminEmail: 'admin@test.com' });
    const res = await request(app).post('/api/v1/auth/business/register').send({
      adminEmail: 'admin@test.com', ...validPayload
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_CONFLICT');
  });

  it('returns 400 for weak password', async () => {
    const res = await request(app).post('/api/v1/auth/business/register').send({
      ...validPayload, adminPassword: '123'
    });
    expect(res.status).toBe(400);
    expect(res.body.invalid_params[0].name).toBe('adminPassword');
  });
});
```

### 5.3 Tenant Isolation (BOLA Prevention)

```typescript
describe('BOLA / Cross-Tenant Isolation', () => {
  it('business A cannot read business B deliveries', async () => {
    const bizA = await seedBusiness();
    const bizB = await seedBusiness();
    const delivery = await seedDelivery({ businessId: bizB.id });

    const tokenA = await loginAs(bizA.owner);

    const res = await request(app)
      .get(`/api/v1/deliveries/${delivery.id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    // Must return 404, not 403, to avoid confirming the resource exists
    expect(res.status).toBe(404);
  });

  it('rider cannot read another business rider wallet', async () => {
    const { rider: riderA, token: tokenA } = await seedRiderWithToken();
    const { rider: riderB } = await seedRiderWithToken();

    const res = await request(app)
      .get(`/api/v1/riders/${riderB.id}/wallet`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
  });
});
```

### 5.4 OTP Flow

```typescript
describe('Rider OTP Login', () => {
  it('issues tokens on correct OTP code', async () => {
    const rider = await seedRider({ phone: '+233240123456' });
    
    // Request OTP
    const otpRes = await request(app)
      .post('/api/v1/auth/rider/login-otp')
      .send({ phoneNumber: '+233240123456' });
    
    expect(otpRes.status).toBe(200);
    const { otpId } = otpRes.body;

    // Get the raw code from test Redis/DB (test-only helper)
    const rawCode = await getTestOtpCode(otpId);

    // Verify OTP
    const verifyRes = await request(app)
      .post('/api/v1/auth/rider/verify-otp')
      .send({ phoneNumber: '+233240123456', otpId, code: rawCode });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body).toHaveProperty('accessToken');
    expect(verifyRes.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('refreshToken')])
    );
  });

  it('returns 400 after 3 incorrect attempts (OTP invalidated)', async () => {
    const { otpId } = await requestOtp('+233240123456');
    
    for (let i = 0; i < 3; i++) {
      await request(app).post('/api/v1/auth/rider/verify-otp')
        .send({ phoneNumber: '+233240123456', otpId, code: '000000' });
    }

    // 4th attempt — even with correct code — must fail
    const rawCode = await getTestOtpCode(otpId);
    const res = await request(app).post('/api/v1/auth/rider/verify-otp')
      .send({ phoneNumber: '+233240123456', otpId, code: rawCode });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_INVALIDATED');
  });

  it('rejects expired OTP', async () => {
    const { otpId } = await requestOtp('+233240123456');
    await expireOtp(otpId); // test helper: sets TTL to 0

    const res = await request(app).post('/api/v1/auth/rider/verify-otp')
      .send({ phoneNumber: '+233240123456', otpId, code: '123456' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_EXPIRED');
  });
});
```

---

## 6. Payment & Payout Tests

These are the highest-risk test cases in the system. Every test case maps to a financial safety guarantee.

```typescript
describe('Payout Safety — Financial Integrity', () => {
  it('deducts rider wallet balance on approved payout', async () => {
    const rider = await seedRiderWithBalance({ balanceMinor: 50000 });
    await approvePayoutFor(rider, { amountMinor: 10000 });

    const wallet = await getWallet(rider.id);
    expect(wallet.balanceMinor).toBe(40000);
  });

  it('creates a DEBIT ledger entry for every payout', async () => {
    const rider = await seedRiderWithBalance({ balanceMinor: 50000 });
    const payout = await approvePayoutFor(rider, { amountMinor: 10000 });

    const ledger = await getLedgerEntries(rider.walletId);
    const debit = ledger.find(e => e.referenceId === payout.id);
    expect(debit).toBeDefined();
    expect(debit.type).toBe('DEBIT');
    expect(debit.amountMinor).toBe(10000);
    expect(debit.balanceAfterMinor).toBe(40000);
  });

  it('returns 402 when rider has insufficient balance', async () => {
    const rider = await seedRiderWithBalance({ balanceMinor: 5000 });
    const res = await requestPayout(rider, { amountMinor: 10000 });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('CRITICAL: concurrent payouts do not overdraft wallet', async () => {
    const rider = await seedRiderWithBalance({ balanceMinor: 10000 });

    // Fire 5 simultaneous payout requests for 5000 each (total 25000 > 10000)
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        approvePayoutFor(rider, { amountMinor: 5000 })
      )
    );

    const succeeded = results.filter(r => r.status === 'fulfilled');
    // Only 2 can succeed (10000 / 5000 = 2), rest must fail with 402
    expect(succeeded.length).toBeLessThanOrEqual(2);

    const wallet = await getWallet(rider.id);
    expect(wallet.balanceMinor).toBeGreaterThanOrEqual(0);
  });

  it('rolls back wallet debit if Moolre API returns error', async () => {
    moolreServer.use(
      http.post('*/transfers', () => HttpResponse.error())
    );

    const rider = await seedRiderWithBalance({ balanceMinor: 50000 });
    const initialBalance = 50000;

    await approvePayoutFor(rider, { amountMinor: 10000 }).catch(() => {});

    const wallet = await getWallet(rider.id);
    expect(wallet.balanceMinor).toBe(initialBalance); // Must be fully restored
  });

  it('webhook reconciliation does not double-credit on replay', async () => {
    const biz = await seedBusinessWithBalance({ balanceMinor: 0 });
    const webhookPayload = buildMoolreWebhook({ ref: 'ref_123', amount: 50000 });

    // Send the same webhook twice
    await processWebhook(webhookPayload);
    await processWebhook(webhookPayload);

    const wallet = await getBusinessWallet(biz.id);
    // Must be credited exactly once
    expect(wallet.balanceMinor).toBe(50000);
  });
});
```

---

## 7. Security Tests

```typescript
describe('Security — Authentication & Authorization', () => {
  it('rejects JWT with alg:none', async () => {
    const forgedToken = buildJwt({ alg: 'none', role: 'SUPER_ADMIN' });
    const res = await request(app)
      .get('/api/v1/deliveries')
      .set('Authorization', `Bearer ${forgedToken}`);
    expect(res.status).toBe(401);
  });

  it('rejects webhook with invalid HMAC signature', async () => {
    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('X-Moolre-Signature', 'invalid_signature')
      .send({ transactionReference: 'ref_123', status: 'SUCCESS', amount: 500 });
    expect(res.status).toBe(401);
  });

  it('blocks request after 5 failed login attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/business/login')
        .send({ email: 'owner@test.com', password: 'wrong' });
    }
    const res = await request(app).post('/api/v1/auth/business/login')
      .send({ email: 'owner@test.com', password: 'correct' });
    expect(res.status).toBe(429);
  });

  it('revoked JWT is rejected after logout', async () => {
    const { token } = await loginAs(businessOwner);
    await request(app).post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    
    const res = await request(app).get('/api/v1/deliveries')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('response headers include all required security headers', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});
```

---

## 8. End-to-End Tests (Playwright)

E2E tests cover only the **critical user journeys** — the paths where a failure means money is lost, a rider cannot work, or a business cannot operate.

### 8.1 Critical User Journey Registry

These journeys **must never fail** in production. If any one of these is broken, a deployment is blocked:

```typescript
// e2e/journeys/

1. business-register.spec.ts
   → A business owner completes registration, receives confirmation,
     and can immediately log into the dashboard.

2. rider-login-otp.spec.ts
   → A rider enters phone number, receives OTP SMS,
     enters code, and lands on the Assigned Jobs screen.

3. create-dispatch-delivery.spec.ts
   → A business manager creates a delivery, assigns a rider,
     and sees the delivery appear in the Active Deliveries table.

4. rider-complete-delivery.spec.ts
   → A rider views an assigned job, slides to "Pick Up",
     slides to "Deliver", and the delivery status updates to DELIVERED
     in the business dashboard.

5. rider-cashout.spec.ts
   → A rider with sufficient balance clicks "Request Cashout",
     completes OTP verification, and sees a PENDING payout
     in their transaction history.

6. business-fund-wallet.spec.ts
   → A business owner initiates wallet funding via MoMo prompt,
     and after the simulated Moolre webhook, the wallet balance
     is updated on the dashboard.

7. cross-tenant-isolation.spec.ts
   → A business manager authenticated to Business A navigates
     directly to a URL referencing Business B's delivery ID
     and receives a 404 — not the resource.
```

### 8.2 Sample E2E Test

```typescript
// e2e/journeys/rider-complete-delivery.spec.ts

test('Rider completes delivery end-to-end', async ({ page, mobileContext }) => {
  // Business admin creates delivery
  await adminPage.goto('/create-delivery');
  await adminPage.fill('[data-testid=pickup-address]', '12 Ring Road, Accra');
  await adminPage.fill('[data-testid=delivery-address]', 'Cantonments, Accra');
  await adminPage.fill('[data-testid=fee-amount]', '50');
  await adminPage.selectOption('[data-testid=rider-select]', riderKwame.id);
  await adminPage.click('[data-testid=submit-delivery]');

  const trackingNumber = await adminPage
    .locator('[data-testid=success-tracking-number]').textContent();

  // Rider sees assigned job on PWA
  const riderPage = await mobileContext.newPage();
  await loginAsRider(riderPage, riderKwame);
  await expect(riderPage.locator(`text=${trackingNumber}`)).toBeVisible();

  // Rider slides to pick up
  await riderPage.locator('[data-testid=slide-pickup]').dragTo(
    riderPage.locator('[data-testid=slide-pickup-target]')
  );
  await expect(riderPage.locator('text=PICKED_UP')).toBeVisible();

  // Rider slides to deliver
  await riderPage.locator('[data-testid=slide-deliver]').dragTo(
    riderPage.locator('[data-testid=slide-deliver-target]')
  );
  await expect(riderPage.locator('text=DELIVERED')).toBeVisible();

  // Business dashboard reflects status
  await adminPage.goto(`/deliveries/${trackingNumber}`);
  await expect(adminPage.locator('[data-testid=delivery-status]'))
    .toHaveText('DELIVERED');
});
```

---

## 9. Test Coverage Targets

| Layer | Coverage Target | Rationale |
| :--- | :--- | :--- |
| Business logic / services | ≥ 90% | Pure functions — full coverage is cheap and high-value |
| API route handlers | ≥ 80% | All success + primary error paths |
| Auth middleware | 100% | Security-critical — zero gaps accepted |
| Financial service (payouts, ledger) | 100% | Every code path directly involves money |
| Moolre integration service | ≥ 85% | Includes timeout, retry, and failure paths |
| React components | ≥ 60% | Focus on interactive state, not render snapshots |
| E2E critical journeys | 100% | All 7 journeys must always pass |

---

## 10. CI/CD Integration

```yaml
# .github/workflows/ci.yml (structure)

on: [push, pull_request]

jobs:
  quality-gates:
    steps:
      - name: Type check
        run: tsc --noEmit

      - name: Lint
        run: eslint . --max-warnings 0

      - name: Unit Tests
        run: vitest run --coverage

      - name: Integration Tests
        run: vitest run --project integration

      - name: Security Headers Check
        run: vitest run --project security

  e2e:
    needs: quality-gates
    steps:
      - name: Start staging environment
        run: docker-compose up -d

      - name: Run E2E Critical Journeys
        run: playwright test e2e/journeys/

      # E2E failure = deployment blocked, no exceptions
      - name: Upload Playwright Report on Failure
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: playwright-report/
```

**Non-negotiable CI gates**: TypeScript errors, unit test failures, integration test failures, or any of the 7 critical E2E journeys failing will block the merge. No exceptions.
