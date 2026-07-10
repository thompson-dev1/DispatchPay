# DispatchPay Moolre Integration Specification

This document specifies the integration layer between **DispatchPay** and the **Moolre API**, covering payments, transfers, SMS, accounts, error handling, resiliency, and financial safety guidelines.

---

## 1. Moolre API Services

We integrate with four core sub-services of the Moolre platform:

```
+-------------------------------------------------------------------------------------------------+
|                                     DISPATCHPAY BACKEND API                                     |
+-------------------------------------------------------------------------------------------------+
          │                                 │                              │
          ├── (1) Collect Funding           ├── (2) Disburse Payouts       ├── (3) Send OTP/Alerts
          v                                 v                              v
+───────────────────+             +───────────────────+          +───────────────────+
|   Payments API    |             |   Transfers API   |          |     SMS API       |
+───────────────────+             +───────────────────+          +───────────────────+
| Initiates mobile  |             | Triggers instant  |          | Sends 2FA login   |
| money collection  |             | payouts to rider  |          | codes and transactional|
| prompts to fund   |             | wallets.          |          | delivery updates. |
| business wallets. |             |                   |          |                   |
+───────────────────+             +───────────────────+          +───────────────────+
                                            │
                                            ├─ (4) Audit Balance checks
                                            v
                                  +───────────────────+
                                  |    Account API    |
                                  +───────────────────+
                                  | Retrieves platform|
                                  | cash reserves for |
                                  | health diagnostics.|
                                  +───────────────────+
```

### When each API is Called
1.  **Payments API**: Executed when a business owner initiates a wallet-funding request. The API requests a Mobile Money Debit from the business's collection phone number.
2.  **Transfers API**: Executed when a business manager or owner approves a rider's withdrawal request. The API pushes funds directly to the rider's phone number/mobile money wallet.
3.  **SMS API**: Triggered dynamically during two-factor authentication events (OTP login, payout approvals) or when dispatch alerts are broadcast to riders.
4.  **Account API**: Invoked during periodic automated health checks (every 10 minutes) and on-demand by system administrators to audit platform liquidity vs. liabilities.

---

## 2. Integration Layer Architecture

The integration logic resides in `apps/backend-api/src/services/moolre.service.ts` using a class-based structure.

```typescript
export class MoolreService {
  private client: AxiosInstance;
  private webhookSecret: string;

  constructor(config: MoolreConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 10000, // 10s default timeout
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    this.webhookSecret = config.webhookSecret;
  }
  
  // Methods mapping to Moolre APIs:
  // - fundWallet(payload: FundWalletDto): Promise<MoolrePaymentResponse>
  // - disbursePayout(payload: DisbursePayoutDto, idempotencyKey: string): Promise<MoolreTransferResponse>
  // - checkTransferStatus(referenceId: string): Promise<MoolreTransferStatusResponse>
  // - getAccountBalance(): Promise<MoolreBalanceResponse>
  // - sendSms(payload: SendSmsDto): Promise<MoolreSmsResponse>
}
```

---

## 3. Resilience & Failure Handling Strategy

### Outbound Request Lifecycle Flow
```
[ Outbound Request ]
         │
         ▼
[ Timeout Check (10s) ] ── (Aborts request if unresponsive)
         │
         ▼
[ Network/5xx Error? ]
         ├── Yes ──► [ Exponential Backoff + Jitter Retry (Max 3) ] ──► (Success or fail after retries)
         └── No ───► [ Verify Response Code ]
                           ├── 4xx Error (Validation/Auth) ──► [ Abort immediately, raise alert ]
                           └── 2xx Success ──────────────────► [ Return data ]
```

### Timeout Strategy
*   Every network call to Moolre has a strict **10-second request timeout**.
*   If Moolre does not respond within this window, the HTTP client aborts the request, raising a `TimeoutException`. This prevents thread pool starvation on the Backend API.

### Retry Logic (Exponential Backoff with Jitter)
*   For transient issues (e.g., `502 Bad Gateway`, `503 Service Unavailable`, `504 Gateway Timeout`, or network socket hangs), DispatchPay performs automatic retries.
*   **Retry Policy**:
    *   **Maximum Retries**: 3.
    *   **Backoff Delay**: $BaseDelay \times 2^{attempt} + Jitter$.
        *   Attempt 1: ~1.5s delay.
        *   Attempt 2: ~3.0s delay.
        *   Attempt 3: ~6.0s delay.
*   **Important**: Retries are **never** executed for client errors (`400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `422 Unprocessable Entity`), as retrying validation errors will result in the same failure.

---

## 4. Preventing Duplicate Payouts (Idempotency)

Financial integrity is maintained by enforcing idempotency keys across all transfer stages:

```
[ Payout Requested ]
         │
         ▼
[ Create UUID: payout_12345 ]
         │
         ▼
[ Save Pending Transaction in DB ]
         │
         ▼
[ Send Outbound HTTP Post to Moolre ]
  Headers: "Idempotency-Key: payout_12345"
         │
         ▼
┌───────────────────────── Network Drop / Connection Reset ─────────────────────────┐
│                                                                                    │
│  [ Retried Outbound HTTP Post ]                                                    │
│  Headers: "Idempotency-Key: payout_12345"                                          │
│                                                                                    │
│  Moolre verifies:                                                                  │
│  - "Has key payout_12345 been seen in past 24 hrs?"                                │
│  - Yes! --> Do not disburse again. Return original payload success reference.     │
└────────────────────────────────────────────────────────────────────────────────────┘
```

1.  **Unique Transaction UUID**: When a payout request is authorized, DispatchPay generates a unique tracking ID (`payout_uuid`).
2.  **Idempotency Header**: The backend sends this UUID in the `Idempotency-Key` custom header when POSTing to `/transfers`.
3.  **Moolre Server Verification**: Moolre maintains a registry of idempotency keys for a rolling 24-hour period. If the network connection drops during a transfer and DispatchPay retries the request:
    *   If Moolre successfully completed the transfer previously, it bypasses the processing engine and returns the cached transaction response.
    *   If Moolre was interrupted during the initial transfer, it resumes processing rather than executing a new transaction.

---

## 5. Webhook Signature Verification

Webhooks are public endpoints that are vulnerable to forgery. To secure incoming Moolre callbacks:
*   Moolre signs webhook payloads with an HMAC signature (`X-Moolre-Signature`) generated using the shared webhook secret.
*   The DispatchPay webhook receiver intercepts the raw payload buffer and computes the signature locally:
    $$\text{HMAC-SHA256}(\text{Shared Secret}, \text{Raw Request Payload})$$
*   If the computed signature matches the header value, the payload is verified and processed; otherwise, it is rejected with a `401 Unauthorized` code.

---

## 6. Failure Recovery & Reconciliation

Webhooks can fail to deliver due to intermediate gateway errors. We use a multi-tiered reconciliation strategy:

```
+-------------------------------------------------------------------------------------------------+
|                                RECONCILIATION & RECOVERY MATRIX                                 |
+-------------------------------------------------------------------------------------------------+

                      +--------------------------------------+
                      |      Rider Payout Initiated          |
                      |   (Status set to PROCESSING in DB)   |
                      +------------------+-------------------+
                                         |
                                         | (Normal Flow: Webhook Received)
                                         v
                      +--------------------------------------+
                      |  Update status to SUCCESS or FAILED  |
                      +------------------+-------------------+
                                         |
                                         | (Failure Scenario: Webhook lost)
                                         v
                      +--------------------------------------+
                      |       Reconciliation Cron (30m)      |
                      |  Queries: PROCESSING state > 30 mins |
                      +------------------+-------------------+
                                         |
                                         | (API Call: GET /transfers/status/:ref)
                                         v
                      +------------------+-------------------+
                      |   Reconcile DB State based on Query  |
                      +--------------------------------------+
```

### Async State Machine Execution
*   When DispatchPay calls the Transfers API and receives a `202 Accepted` response, the database record is updated to `PROCESSING`. The funds remain locked in the rider's wallet.
*   Upon receiving a valid webhook showing `SUCCESS`, the state changes to `SUCCESS`, and the funds are permanently deducted.
*   If the webhook reports a `FAILED` status, the state updates to `FAILED`, the funds are unlocked, and the rider's wallet balance is restored.

### Fallback Reconciliation Job (Cron Engine)
*   A background worker runs every 10 minutes to find records marked as `PROCESSING` for longer than 30 minutes.
*   The job queries the Moolre API using the transaction reference:
    `GET /v1/transfers/status/:provider_reference`
*   The database is updated based on the API response. If Moolre has no record of the transaction reference, the transaction is marked as `FAILED` and the rider's locked balance is returned.
*   Any discrepancies trigger slack/email alerts to the engineering operations channel for manual review.
