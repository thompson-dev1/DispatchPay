# DispatchPay Database Schema Design

**ORM**: Drizzle ORM  
**Database**: Turso (libSQL / distributed SQLite)  
**Key principle**: All monetary values stored in **minor units** (integers) — e.g. GHS 10.50 → `1050`

---

## 1. ER Diagram

```
                  +───────────────────+
                  │    businesses     │
                  +────────┬──────────+
                           │ 1
                           │ 1..*
                  +────────▼──────────+
                  │       users       │◄──────────────────────+
                  +────────┬──────────+                        │
                           │ 1                                 │
                           │ 1 (shared PK / extends)           │
                  +────────▼──────────+                        │
                  │      riders       │◄──────────+            │
                  +────────┬──────────+            │            │
                           │ 1                    │            │
                           │ 0..*                 │ 0..*       │ 1..*
                  +────────▼──────────+            │            │
                  │    deliveries     │◄──+        │            │
                  +────────┬──────────+   │        │            │
                           │ 1           │        │            │
                           │ 1..*        │ 1      │ 1          │
                  +────────▼──────────+   │        │            │
                  │ delivery_history  │   │        │            │
                  +───────────────────+   │        │            │
                                         │        │            │
                  +───────────────────+   │        │            │
                  │      payouts      │───+────────+            │
                  +───────────────────+                         │
                                                               │
                  +───────────────────+                         │
                  │     payments      │                         │
                  +───────────────────+                         │
                                                               │
                  +───────────────────+                         │
                  │  otp_verifications│                         │
                  +───────────────────+                         │
                                                               │
                  +───────────────────+                         │
                  │     sms_logs      │                         │
                  +───────────────────+                         │
                                                               │
                  +───────────────────+                         │
                  │      wallets      │◄────────────────────────+
                  +────────┬──────────+
                           │ 1
                           │ 1..*
                  +────────▼──────────+
                  │   ledger_entries  │
                  +───────────────────+
```

---

## 2. Enums (SQLite CHECK constraints via TypeScript constants)

```typescript
export const UserRole = {
  SUPER_ADMIN:       'SUPER_ADMIN',
  BUSINESS_OWNER:    'BUSINESS_OWNER',
  BUSINESS_MANAGER:  'BUSINESS_MANAGER',
  RIDER:             'RIDER',
} as const;

export const VehicleType = {
  BICYCLE:    'BICYCLE',
  MOTORCYCLE: 'MOTORCYCLE',
  CAR:        'CAR',
  VAN:        'VAN',
} as const;

export const MomoNetwork = {
  MTN:        'MTN',
  TELECEL:    'TELECEL',
  AIRTELTIGO: 'AIRTELTIGO',
} as const;

export const DeliveryStatus = {
  PENDING:   'PENDING',
  ASSIGNED:  'ASSIGNED',
  PICKED_UP: 'PICKED_UP',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
} as const;

export const WalletOwnerType = {
  BUSINESS: 'BUSINESS',
  RIDER:    'RIDER',
} as const;

export const LedgerEntryType = {
  DEBIT:  'DEBIT',
  CREDIT: 'CREDIT',
} as const;

export const LedgerReferenceType = {
  PAYMENT:             'PAYMENT',
  PAYOUT:              'PAYOUT',
  DELIVERY_FEE:        'DELIVERY_FEE',
  DELIVERY_COMMISSION: 'DELIVERY_COMMISSION',
  WALLET_ADJUSTMENT:   'WALLET_ADJUSTMENT',
} as const;
```

---

## 3. Table Definitions

### `businesses`
The top-level multi-tenant root. Every piece of data belongs to a business.

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PK | UUID v7 |
| `name` | TEXT | NOT NULL | Business display name |
| `email` | TEXT | NOT NULL, UNIQUE | Primary contact email |
| `created_at` | INTEGER | NOT NULL, DEFAULT NOW | Unix timestamp |
| `updated_at` | INTEGER | NOT NULL, DEFAULT NOW | Unix timestamp |

---

### `users`
Unified authentication root for all user types (business admins + riders). Role-based fields are nullable depending on login method.

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PK | UUID v7 |
| `email` | TEXT | UNIQUE | Null for phone-only riders |
| `phone_number` | TEXT | UNIQUE | Null for email/password admins |
| `password_hash` | TEXT | — | Null for OTP-only riders |
| `role` | TEXT | NOT NULL | `UserRole` enum value |
| `business_id` | TEXT | FK → businesses.id CASCADE | Tenant ownership |
| `is_active` | INTEGER | NOT NULL, DEFAULT 1 | Boolean; 0 = deactivated |
| `created_at` | INTEGER | NOT NULL | Unix timestamp |
| `updated_at` | INTEGER | NOT NULL | Unix timestamp |

**Indexes**: `users_role_idx` on `role`, `users_business_id_idx` on `business_id`

**Design decision**: A single `users` table as the auth root prevents session/JWT complexity. The `riders` table is a 1-to-1 profile extension — `riders.id = users.id`.

---

### `riders`
Profile extension of `users` — primary key is a shared foreign key to `users.id`.

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PK, FK → users.id CASCADE | Same ID as parent user |
| `business_id` | TEXT | NOT NULL, FK → businesses.id CASCADE | Tenant |
| `first_name` | TEXT | NOT NULL | |
| `last_name` | TEXT | NOT NULL | |
| `vehicle_type` | TEXT | NOT NULL | `VehicleType` enum |
| `vehicle_plate` | TEXT | — | Optional license plate |
| `momo_network` | TEXT | NOT NULL | `MomoNetwork` enum |
| `momo_number` | TEXT | NOT NULL | MoMo payout phone number |
| `created_at` | INTEGER | NOT NULL | Unix timestamp |
| `updated_at` | INTEGER | NOT NULL | Unix timestamp |

**Indexes**: `riders_business_id_idx` on `business_id`

---

### `wallets`
One wallet per entity (one per business, one per rider). Balances are the **sum** of all ledger entries — the `balance_minor` column is a cached running total.

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PK | UUID v7 |
| `owner_id` | TEXT | NOT NULL | References `businesses.id` or `users.id` |
| `owner_type` | TEXT | NOT NULL | `WalletOwnerType` enum |
| `balance_minor` | INTEGER | NOT NULL, DEFAULT 0 | Cached balance in minor units (pesewas) |
| `currency` | TEXT | NOT NULL, DEFAULT 'GHS' | ISO 4217 code |
| `created_at` | INTEGER | NOT NULL | Unix timestamp |
| `updated_at` | INTEGER | NOT NULL | Unix timestamp |

**Indexes**: `wallets_owner_idx` — UNIQUE composite on `(owner_id, owner_type)` → one wallet per entity enforced at DB level.

---

### `ledger_entries`
Immutable double-entry financial log. **Never updated or deleted.** Every credit or debit writes a new row.

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PK | UUID v7 |
| `wallet_id` | TEXT | NOT NULL, FK → wallets.id RESTRICT | RESTRICT prevents orphan logs |
| `type` | TEXT | NOT NULL | `DEBIT` or `CREDIT` |
| `amount_minor` | INTEGER | NOT NULL | Always positive |
| `balance_after_minor` | INTEGER | NOT NULL | Snapshot of balance after this entry |
| `reference_type` | TEXT | NOT NULL | `LedgerReferenceType` enum |
| `reference_id` | TEXT | NOT NULL | ID of the triggering record |
| `description` | TEXT | NOT NULL | Human-readable audit description |
| `created_at` | INTEGER | NOT NULL | Unix timestamp |

**Indexes**: `ledger_entries_wallet_idx` on `wallet_id`, `ledger_entries_reference_idx` on `(reference_type, reference_id)`

**Design decision**: `onDelete: 'restrict'` on `wallet_id` means you cannot delete a wallet that has transactions. This is a financial safety constraint — deletion is blocked at the database level, not just in application code.

---

### `deliveries`
Core entity. All three monetary columns are stored at creation time to create an immutable financial snapshot.

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PK | UUID v7 |
| `business_id` | TEXT | NOT NULL, FK → businesses.id RESTRICT | |
| `rider_id` | TEXT | FK → riders.id SET NULL | Null when unassigned |
| `tracking_number` | TEXT | NOT NULL, UNIQUE | Human-readable e.g. `DP-2026-0001` |
| `status` | TEXT | NOT NULL, DEFAULT 'PENDING' | `DeliveryStatus` enum |
| `pickup_address` | TEXT | NOT NULL | |
| `delivery_address` | TEXT | NOT NULL | |
| `pickup_latitude` | REAL | — | Optional GPS |
| `pickup_longitude` | REAL | — | Optional GPS |
| `delivery_latitude` | REAL | — | Optional GPS |
| `delivery_longitude` | REAL | — | Optional GPS |
| `distance_km` | REAL | — | Optional computed distance |
| `fee_amount_minor` | INTEGER | NOT NULL | Total fee charged to customer |
| `commission_amount_minor` | INTEGER | NOT NULL | Business's share |
| `payout_amount_minor` | INTEGER | NOT NULL | Rider's share = fee - commission |
| `created_at` | INTEGER | NOT NULL | Unix timestamp |
| `updated_at` | INTEGER | NOT NULL | Unix timestamp |

**Indexes**: `deliveries_business_idx`, `deliveries_rider_idx`, `deliveries_status_idx`

**Design decision**: `fee_amount_minor`, `commission_amount_minor`, and `payout_amount_minor` are denormalized at creation — the split is locked in when the delivery is created, not derived dynamically. This prevents rate-change disputes.

---

### `delivery_status_history`
Append-only audit trail of every delivery status change. Never updated.

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PK | UUID v7 |
| `delivery_id` | TEXT | NOT NULL, FK → deliveries.id CASCADE | |
| `status` | TEXT | NOT NULL | `DeliveryStatus` value at point of change |
| `changed_by_id` | TEXT | NOT NULL, FK → users.id RESTRICT | Who triggered the status change |
| `latitude` | REAL | — | Optional GPS at time of status change |
| `longitude` | REAL | — | Optional GPS at time of status change |
| `notes` | TEXT | — | Optional rider/manager notes |
| `created_at` | INTEGER | NOT NULL | Unix timestamp |

**Indexes**: `delivery_status_history_delivery_idx` on `delivery_id`

---

### `otp_verifications`
Short-lived OTP records. Expired and verified records are pruned by a cron job.

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PK | UUID v7 (this is the `otpId` sent to client) |
| `phone_number` | TEXT | NOT NULL | Target phone |
| `code` | TEXT | NOT NULL | **Hashed** OTP code (SHA-256) |
| `purpose` | TEXT | NOT NULL | `LOGIN` or `PAYOUT_VERIFICATION` |
| `status` | TEXT | NOT NULL, DEFAULT 'PENDING' | `PENDING`, `VERIFIED`, `EXPIRED` |
| `expires_at` | INTEGER | NOT NULL | Unix timestamp (5-minute TTL) |
| `created_at` | INTEGER | NOT NULL | Unix timestamp |

**Indexes**: `otp_verifications_phone_code_idx` on `(phone_number, code)`

---

### `payments`
Inbound wallet funding records. Tracks MoMo payment lifecycle from initiation to Moolre webhook confirmation.

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PK | UUID v7 |
| `business_id` | TEXT | NOT NULL, FK → businesses.id RESTRICT | |
| `amount_minor` | INTEGER | NOT NULL | Amount in minor units |
| `currency` | TEXT | NOT NULL, DEFAULT 'GHS' | |
| `status` | TEXT | NOT NULL, DEFAULT 'PENDING' | `PENDING`, `SUCCESS`, `FAILED` |
| `payment_method` | TEXT | NOT NULL | `MOMO`, `CARD`, `BANK` |
| `provider_reference` | TEXT | UNIQUE | Moolre transaction reference |
| `metadata` | TEXT | — | JSON string of gateway response |
| `created_at` | INTEGER | NOT NULL | Unix timestamp |
| `updated_at` | INTEGER | NOT NULL | Unix timestamp |

**Indexes**: `payments_business_idx`, `payments_provider_ref_idx` (UNIQUE — prevents double-processing same webhook reference)

---

### `payouts`
Outbound rider cashout records. The `provider_reference` unique index is the idempotency guard against double payouts.

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PK | UUID v7 |
| `business_id` | TEXT | NOT NULL, FK → businesses.id RESTRICT | |
| `rider_id` | TEXT | NOT NULL, FK → riders.id RESTRICT | |
| `amount_minor` | INTEGER | NOT NULL | Amount in minor units |
| `currency` | TEXT | NOT NULL, DEFAULT 'GHS' | |
| `status` | TEXT | NOT NULL, DEFAULT 'PENDING' | `PENDING`, `PROCESSING`, `SUCCESS`, `FAILED` |
| `recipient_phone` | TEXT | NOT NULL | Snapshot of rider's MoMo number at payout time |
| `recipient_network` | TEXT | NOT NULL | `MomoNetwork` snapshot |
| `provider_reference` | TEXT | UNIQUE | Moolre transfer reference |
| `error_message` | TEXT | — | Failure reason if status = FAILED |
| `created_at` | INTEGER | NOT NULL | Unix timestamp |
| `updated_at` | INTEGER | NOT NULL | Unix timestamp |

**Indexes**: `payouts_rider_idx`, `payouts_business_idx`, `payouts_provider_ref_idx` (UNIQUE)

**Design decision**: `recipient_phone` and `recipient_network` are snapshotted at payout creation time. If the rider changes their MoMo number tomorrow, historical payout records still show the number the money was actually sent to.

---

### `sms_logs`
Delivery receipt audit trail for all outbound SMS messages.

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PK | UUID v7 |
| `phone_number` | TEXT | NOT NULL | Recipient |
| `message` | TEXT | NOT NULL | SMS body sent |
| `provider_reference` | TEXT | — | Twilio/AT message SID |
| `status` | TEXT | NOT NULL, DEFAULT 'PENDING' | `PENDING`, `SENT`, `FAILED` |
| `error_message` | TEXT | — | Failure reason |
| `created_at` | INTEGER | NOT NULL | Unix timestamp |

**Indexes**: `sms_logs_phone_idx` on `phone_number`

---

## 4. Complete Drizzle Schema (`packages/db/src/schema.ts`)

```typescript
import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

// ── BUSINESSES ─────────────────────────────────────────────────────────────
export const businesses = sqliteTable('businesses', {
  id:        text('id').primaryKey(),
  name:      text('name').notNull(),
  email:     text('email').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ── USERS ──────────────────────────────────────────────────────────────────
export const users = sqliteTable('users', {
  id:           text('id').primaryKey(),
  email:        text('email').unique(),
  phoneNumber:  text('phone_number').unique(),
  passwordHash: text('password_hash'),
  role:         text('role').notNull(),
  businessId:   text('business_id').references(() => businesses.id, { onDelete: 'cascade' }),
  isActive:     integer('is_active', { mode: 'boolean' }).default(true).notNull(),
  createdAt:    integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt:    integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  roleIdx:       index('users_role_idx').on(t.role),
  businessIdIdx: index('users_business_id_idx').on(t.businessId),
}));

// ── RIDERS ─────────────────────────────────────────────────────────────────
export const riders = sqliteTable('riders', {
  id:           text('id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  businessId:   text('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  firstName:    text('first_name').notNull(),
  lastName:     text('last_name').notNull(),
  vehicleType:  text('vehicle_type').notNull(),
  vehiclePlate: text('vehicle_plate'),
  momoNetwork:  text('momo_network').notNull(),
  momoNumber:   text('momo_number').notNull(),
  createdAt:    integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt:    integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  businessIdIdx: index('riders_business_id_idx').on(t.businessId),
}));

// ── WALLETS ────────────────────────────────────────────────────────────────
export const wallets = sqliteTable('wallets', {
  id:             text('id').primaryKey(),
  ownerId:        text('owner_id').notNull(),
  ownerType:      text('owner_type').notNull(),
  balanceMinor:   integer('balance_minor').default(0).notNull(),
  currency:       text('currency').default('GHS').notNull(),
  createdAt:      integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt:      integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  ownerIdx: uniqueIndex('wallets_owner_idx').on(t.ownerId, t.ownerType),
}));

// ── LEDGER ENTRIES ─────────────────────────────────────────────────────────
export const ledgerEntries = sqliteTable('ledger_entries', {
  id:                 text('id').primaryKey(),
  walletId:           text('wallet_id').notNull().references(() => wallets.id, { onDelete: 'restrict' }),
  type:               text('type').notNull(),
  amountMinor:        integer('amount_minor').notNull(),
  balanceAfterMinor:  integer('balance_after_minor').notNull(),
  referenceType:      text('reference_type').notNull(),
  referenceId:        text('reference_id').notNull(),
  description:        text('description').notNull(),
  createdAt:          integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  walletIdx:    index('ledger_entries_wallet_idx').on(t.walletId),
  referenceIdx: index('ledger_entries_reference_idx').on(t.referenceType, t.referenceId),
}));

// ── DELIVERIES ─────────────────────────────────────────────────────────────
export const deliveries = sqliteTable('deliveries', {
  id:                     text('id').primaryKey(),
  businessId:             text('business_id').notNull().references(() => businesses.id, { onDelete: 'restrict' }),
  riderId:                text('rider_id').references(() => riders.id, { onDelete: 'set null' }),
  trackingNumber:         text('tracking_number').notNull().unique(),
  status:                 text('status').default('PENDING').notNull(),
  pickupAddress:          text('pickup_address').notNull(),
  deliveryAddress:        text('delivery_address').notNull(),
  pickupLatitude:         real('pickup_latitude'),
  pickupLongitude:        real('pickup_longitude'),
  deliveryLatitude:       real('delivery_latitude'),
  deliveryLongitude:      real('delivery_longitude'),
  distanceKm:             real('distance_km'),
  feeAmountMinor:         integer('fee_amount_minor').notNull(),
  commissionAmountMinor:  integer('commission_amount_minor').notNull(),
  payoutAmountMinor:      integer('payout_amount_minor').notNull(),
  createdAt:              integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt:              integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  businessIdx: index('deliveries_business_idx').on(t.businessId),
  riderIdx:    index('deliveries_rider_idx').on(t.riderId),
  statusIdx:   index('deliveries_status_idx').on(t.status),
}));

// ── DELIVERY STATUS HISTORY ────────────────────────────────────────────────
export const deliveryStatusHistory = sqliteTable('delivery_status_history', {
  id:          text('id').primaryKey(),
  deliveryId:  text('delivery_id').notNull().references(() => deliveries.id, { onDelete: 'cascade' }),
  status:      text('status').notNull(),
  changedById: text('changed_by_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  latitude:    real('latitude'),
  longitude:   real('longitude'),
  notes:       text('notes'),
  createdAt:   integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  deliveryIdx: index('delivery_status_history_delivery_idx').on(t.deliveryId),
}));

// ── OTP VERIFICATIONS ──────────────────────────────────────────────────────
export const otpVerifications = sqliteTable('otp_verifications', {
  id:          text('id').primaryKey(),
  phoneNumber: text('phone_number').notNull(),
  code:        text('code').notNull(),         // SHA-256 hashed
  purpose:     text('purpose').notNull(),       // 'LOGIN' | 'PAYOUT_VERIFICATION'
  status:      text('status').default('PENDING').notNull(),
  expiresAt:   integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt:   integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  phoneCodeIdx: index('otp_verifications_phone_code_idx').on(t.phoneNumber, t.code),
}));

// ── PAYMENTS ───────────────────────────────────────────────────────────────
export const payments = sqliteTable('payments', {
  id:                text('id').primaryKey(),
  businessId:        text('business_id').notNull().references(() => businesses.id, { onDelete: 'restrict' }),
  amountMinor:       integer('amount_minor').notNull(),
  currency:          text('currency').default('GHS').notNull(),
  status:            text('status').default('PENDING').notNull(),
  paymentMethod:     text('payment_method').notNull(),
  providerReference: text('provider_reference'),
  metadata:          text('metadata'),         // JSON string
  createdAt:         integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt:         integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  businessIdx:      index('payments_business_idx').on(t.businessId),
  providerRefIdx:   uniqueIndex('payments_provider_ref_idx').on(t.providerReference),
}));

// ── PAYOUTS ────────────────────────────────────────────────────────────────
export const payouts = sqliteTable('payouts', {
  id:                text('id').primaryKey(),
  businessId:        text('business_id').notNull().references(() => businesses.id, { onDelete: 'restrict' }),
  riderId:           text('rider_id').notNull().references(() => riders.id, { onDelete: 'restrict' }),
  amountMinor:       integer('amount_minor').notNull(),
  currency:          text('currency').default('GHS').notNull(),
  status:            text('status').default('PENDING').notNull(),
  recipientPhone:    text('recipient_phone').notNull(),   // Snapshotted at payout time
  recipientNetwork:  text('recipient_network').notNull(), // Snapshotted at payout time
  providerReference: text('provider_reference'),
  errorMessage:      text('error_message'),
  createdAt:         integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt:         integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  riderIdx:       index('payouts_rider_idx').on(t.riderId),
  businessIdx:    index('payouts_business_idx').on(t.businessId),
  providerRefIdx: uniqueIndex('payouts_provider_ref_idx').on(t.providerReference),
}));

// ── SMS LOGS ───────────────────────────────────────────────────────────────
export const smsLogs = sqliteTable('sms_logs', {
  id:                text('id').primaryKey(),
  phoneNumber:       text('phone_number').notNull(),
  message:           text('message').notNull(),
  providerReference: text('provider_reference'),
  status:            text('status').default('PENDING').notNull(),
  errorMessage:      text('error_message'),
  createdAt:         integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  phoneIdx: index('sms_logs_phone_idx').on(t.phoneNumber),
}));

// ── RELATIONS ──────────────────────────────────────────────────────────────
export const businessesRelations = relations(businesses, ({ many }) => ({
  users:     many(users),
  riders:    many(riders),
  deliveries: many(deliveries),
  payments:  many(payments),
  payouts:   many(payouts),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  business:      one(businesses, { fields: [users.businessId], references: [businesses.id] }),
  riderProfile:  one(riders,     { fields: [users.id],         references: [riders.id] }),
  statusChanges: many(deliveryStatusHistory),
}));

export const ridersRelations = relations(riders, ({ one, many }) => ({
  user:      one(users,       { fields: [riders.id],         references: [users.id] }),
  business:  one(businesses,  { fields: [riders.businessId], references: [businesses.id] }),
  deliveries: many(deliveries),
  payouts:   many(payouts),
}));

export const walletsRelations = relations(wallets, ({ many }) => ({
  ledgerEntries: many(ledgerEntries),
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
  wallet: one(wallets, { fields: [ledgerEntries.walletId], references: [wallets.id] }),
}));

export const deliveriesRelations = relations(deliveries, ({ one, many }) => ({
  business: one(businesses, { fields: [deliveries.businessId], references: [businesses.id] }),
  rider:    one(riders,     { fields: [deliveries.riderId],    references: [riders.id] }),
  history:  many(deliveryStatusHistory),
}));

export const deliveryStatusHistoryRelations = relations(deliveryStatusHistory, ({ one }) => ({
  delivery:  one(deliveries, { fields: [deliveryStatusHistory.deliveryId],  references: [deliveries.id] }),
  changedBy: one(users,      { fields: [deliveryStatusHistory.changedById], references: [users.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  business: one(businesses, { fields: [payments.businessId], references: [businesses.id] }),
}));

export const payoutsRelations = relations(payouts, ({ one }) => ({
  business: one(businesses, { fields: [payouts.businessId], references: [businesses.id] }),
  rider:    one(riders,     { fields: [payouts.riderId],    references: [riders.id] }),
}));
```

---

## 5. Design Rationale

### Minor Units for Financial Integrity
All monetary amounts are stored as integers in minor units (pesewas for GHS). `GHS 10.50` → `1050`. This eliminates floating-point rounding errors that are endemic in JavaScript/TypeScript when using `number` for currency.

### Double-Entry Ledger
Rather than simply updating a `balance_minor` column, every financial event writes an immutable row to `ledger_entries`. The `balance_after_minor` column creates a running snapshot. A full audit can reconstruct wallet history at any point in time by reading ledger rows in chronological order.

### UUID String Primary Keys
All PKs are UUID v7 strings instead of auto-incrementing integers. Turso distributes writes across edge replicas — sequential integers cause write contention at the primary node. UUIDs are generated client-side and are globally unique without DB coordination.

### `RESTRICT` on Financial Foreign Keys
`ledger_entries.wallet_id` uses `onDelete: 'restrict'`. This means the database itself will reject any attempt to delete a wallet that has transaction history — it cannot be bypassed by application code. Financial audit trails are indestructible at the DB layer.

### Snapshotted Payout Fields
`payouts.recipient_phone` and `payouts.recipient_network` copy the rider's MoMo details at the moment of payout creation. If the rider updates their number later, historical payout records remain accurate — they show the number the money was actually sent to.

### Delivery Fee Denormalization
`deliveries.fee_amount_minor`, `commission_amount_minor`, and `payout_amount_minor` are all written at creation. The financial split is locked in at order time, not dynamically derived. This prevents disputes if commission rates change after an active delivery.

---

## 6. Verification Commands

```bash
# Verify TypeScript compiles without errors
npx tsc --noEmit --project packages/db/tsconfig.json

# Generate migration files
npx drizzle-kit generate

# Apply migrations to dev database
npx drizzle-kit migrate

# Apply migrations to production (Turso)
TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npx drizzle-kit migrate
```
