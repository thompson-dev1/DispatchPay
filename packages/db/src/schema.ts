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
