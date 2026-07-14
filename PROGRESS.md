# DispatchPay — Project Progress Tracker

> Last updated: 2026-07-14
> Two-dev team. Update status column when you finish a task, open a PR, or merge.
> Legend: ✅ Done | 🔄 In Progress | ⬜ Not Started | 🔴 Blocked

---

## Phase 1 — Infrastructure & Database
| Task | Owner | Status | Branch / PR |
|------|-------|--------|-------------|
| Monorepo scaffold (workspaces, tsconfig, shared packages) | Enoch | ✅ Done | merged #2 |
| DB schema (10 tables: businesses, users, riders, wallets, ledger, deliveries, delivery_status_history, payments, payouts, sms_logs, otp_verifications) | Enoch | ✅ Done | merged #6 |
| Drizzle migrations generated & applied (Turso/libSQL) | Enoch | ✅ Done | merged #6 |
| `.env.example` documented | Enoch | ✅ Done | merged |

---

## Phase 2 — Backend API (`apps/backend-api`)
| Task | Owner | Status | Branch / PR |
|------|-------|--------|-------------|
| Fastify server bootstrap (CORS, cookie, JWT, health check) | Enoch | ✅ Done | merged |
| Auth plugin (authenticate + requireRole decorators) | Enoch | ✅ Done | merged #7 |
| `POST /auth/business/register` | Enoch | ✅ Done | merged #7 |
| `POST /auth/business/login` | Enoch | ✅ Done | merged #7 |
| `POST /auth/rider/register` (admin-only) | Enoch | ✅ Done | merged #7 |
| `POST /auth/rider/login-otp` | Enoch | ✅ Done | merged #7 |
| `POST /auth/rider/verify-otp` | Enoch | ✅ Done | merged #7 |
| `POST /auth/refresh` (token rotation) | Enoch | ✅ Done | merged #7 |
| `POST /auth/logout` | Enoch | ✅ Done | merged #7 |
| Businesses CRUD (`GET /businesses`, `GET /businesses/:id`, wallet balance) | Enoch | ✅ Done | merged #11 |
| Riders CRUD (`GET /riders`, `GET /riders/:id`, `PATCH /riders/:id`, `DELETE /riders/:id`) | Enoch | ✅ Done | merged #11 |
| Deliveries CRUD (`POST`, `GET`, `GET /:id`, `PATCH /:id/status`, `PATCH /:id/assign`) | Enoch | ✅ Done | merged #11 |
| `POST /payments/initiate` (MoMo collection) | Bernard | ✅ Done | main |
| `POST /payments/webhook` (Moolre callback) | Bernard | ✅ Done | main |
| `GET /payments` / `GET /payments/:id` | Bernard | ✅ Done | main |
| `POST /payouts/initiate` (OTP dispatched to rider) | Bernard | ✅ Done | main |
| `POST /payouts/verify` (OTP verification + wallet debit/credit + Moolre dispatch) | Bernard | ✅ Done | main |
| `POST /payouts/webhook` (Moolre disbursement callback) | Bernard | ✅ Done | main |
| `GET /payouts` (business payout history) | Bernard | ✅ Done | main |
| MoolreService sandbox stub (initiatePayment, initiatePayout, verifyWebhookSignature) | Bernard | ✅ Done | main |
| **Moolre live HTTP integration** (replace stubs with real API calls) | — | ⬜ Not Started | needs Moolre API credentials |
| Ledger entries double-entry for all wallet movements | Enoch/Bernard | ✅ Done | payments + payouts routes |
| API unit / integration tests | — | ⬜ Not Started | — |

---

## Phase 3 — Frontend: Business Web (`apps/business-web`)
| Task | Owner | Status | Branch / PR |
|------|-------|--------|-------------|
| API client with Axios + silent token refresh | Enoch | ✅ Done | merged #13 |
| AuthContext + AuthProvider | Enoch | ✅ Done | merged #13 |
| `useAuth` hook | Enoch | ✅ Done | merged #13 |
| Login page (`/login`) | — | ⬜ Not Started | — |
| Register page (`/register`) | — | ⬜ Not Started | — |
| Dashboard layout + protected route wrapper | — | ⬜ Not Started | — |
| Deliveries list page | — | ⬜ Not Started | — |
| Create delivery form | — | ⬜ Not Started | — |
| Riders management page | — | ⬜ Not Started | — |
| Payments / wallet top-up page | — | ⬜ Not Started | — |
| Payouts initiation page | — | ⬜ Not Started | — |
| Payout history page | — | ⬜ Not Started | — |

---

## Phase 4 — Frontend: Rider PWA (`apps/rider-pwa`)
| Task | Owner | Status | Branch / PR |
|------|-------|--------|-------------|
| API client (shared or own instance) | — | ⬜ Not Started | — |
| OTP login flow (`/login`) | — | ⬜ Not Started | — |
| Delivery list / current delivery view | — | ⬜ Not Started | — |
| Delivery status update (Picked Up / Delivered) | — | ⬜ Not Started | — |
| Payout authorisation (OTP entry screen) | — | ⬜ Not Started | — |
| Earnings / payout history screen | — | ⬜ Not Started | — |
| PWA manifest + service worker (offline support) | — | ⬜ Not Started | — |

---

## Phase 5 — Quality & DevOps
| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| ESLint + TypeScript root toolchain | Bernard | ✅ Done | merged #14 |
| `npm run sanity` (lint + typecheck + test) | Bernard | ✅ Done | merged #14 |
| `.nvmrc` (Node 20 pin) | Bernard | ✅ Done | merged #14 |
| Backend unit tests (auth, payments, payouts) | — | ⬜ Not Started | use vitest |
| Frontend component tests | — | ⬜ Not Started | use vitest + @testing-library |
| CI pipeline (GitHub Actions: sanity on PR) | — | ⬜ Not Started | — |
| Docker / deployment config | — | ⬜ Not Started | — |
| Production env config & secrets management | — | ⬜ Not Started | — |

---

## 🔴 Open Blockers
| Blocker | Impact | Notes |
|---------|--------|-------|
| Moolre sandbox API credentials not yet obtained | Payments & Payouts work but use sandbox stubs | Contact Moolre to get `MOOLRE_API_KEY`, `MOOLRE_BASE_URL`, `MOOLRE_WEBHOOK_SECRET` |
| `DATABASE_URL` (Turso) needed in `.env` to run DB | Server won't connect to DB locally without it | Copy `.env.example` → `.env` and fill in Turso credentials |
| `JWT_SECRET` and `COOKIE_SECRET` must be set in production | Security risk if defaults are used in prod | Use strong random strings before any deployment |

---

## 📊 Summary
| Layer | Complete | Total | % |
|-------|----------|-------|---|
| Database / Schema | 4 | 4 | 100% |
| Backend API routes | 19 | 20 | 95% (Moolre live pending) |
| Business Web frontend | 3 | 12 | 25% |
| Rider PWA frontend | 0 | 7 | 0% |
| Quality & DevOps | 3 | 8 | 38% |
| **Overall** | **29** | **51** | **~57%** |
