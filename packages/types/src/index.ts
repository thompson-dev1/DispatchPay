import { z } from 'zod';

// ====================================================
// AUTHENTICATION & USERS
// ====================================================

export const userRoleSchema = z.enum([
  'SUPER_ADMIN',
  'BUSINESS_OWNER',
  'BUSINESS_MANAGER',
  'RIDER',
]);

export type UserRole = z.infer<typeof userRoleSchema>;

// POST /auth/business/register
export const businessRegisterSchema = z.object({
  businessName: z.string().min(2, 'Business name must be at least 2 characters'),
  businessEmail: z.string().email('Invalid business email address'),
  adminName: z.string().min(2, 'Admin name must be at least 2 characters'),
  adminEmail: z.string().email('Invalid admin email address'),
  adminPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export type BusinessRegisterInput = z.infer<typeof businessRegisterSchema>;

// POST /auth/business/login
export const businessLoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type BusinessLoginInput = z.infer<typeof businessLoginSchema>;

// POST /auth/rider/register
export const riderRegisterSchema = z.object({
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format (E.164 expected)'),
  vehicleType: z.enum(['BICYCLE', 'MOTORCYCLE', 'CAR', 'VAN']),
  vehiclePlate: z.string().optional(),
  momoNetwork: z.enum(['MTN', 'TELECEL', 'AIRTELTIGO']),
  momoNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid MoMo phone number format (E.164 expected)'),
});

export type RiderRegisterInput = z.infer<typeof riderRegisterSchema>;

// POST /auth/rider/login-otp
export const riderLoginOtpRequestSchema = z.object({
  phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format (E.164 expected)'),
});

export type RiderLoginOtpRequestInput = z.infer<typeof riderLoginOtpRequestSchema>;

// POST /auth/rider/verify-otp
export const riderLoginOtpVerifySchema = z.object({
  phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format (E.164 expected)'),
  otpCode: z.string().length(6, 'OTP code must be exactly 6 digits'),
});

export type RiderLoginOtpVerifyInput = z.infer<typeof riderLoginOtpVerifySchema>;

// ====================================================
// DELIVERIES
// ====================================================

// POST /deliveries
export const createDeliverySchema = z.object({
  pickupAddress: z.string().min(5, 'Pickup address must be at least 5 characters'),
  deliveryAddress: z.string().min(5, 'Delivery address must be at least 5 characters'),
  pickupLatitude: z.number().min(-90).max(90).optional(),
  pickupLongitude: z.number().min(-180).max(180).optional(),
  deliveryLatitude: z.number().min(-90).max(90).optional(),
  deliveryLongitude: z.number().min(-180).max(180).optional(),
  distanceKm: z.number().positive().optional(),
  feeAmountMinor: z.number().int().positive('Fee must be a positive integer in minor units'),
  commissionAmountMinor: z.number().int().nonnegative('Commission must be a non-negative integer in minor units'),
  riderId: z.string().uuid('Invalid Rider UUID format').nullable().optional(),
});

export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;

// PATCH /deliveries/:id/status
export const updateDeliveryStatusSchema = z.object({
  status: z.enum(['PENDING', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'CANCELLED']),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  notes: z.string().max(500, 'Notes cannot exceed 500 characters').optional(),
});

export type UpdateDeliveryStatusInput = z.infer<typeof updateDeliveryStatusSchema>;

// ====================================================
// PAYMENTS & TRANSACTIONS
// ====================================================

// POST /payments/initiate
export const paymentInitiateSchema = z.object({
  amountMinor: z.number().int().positive('Amount must be a positive integer in minor units'),
  paymentMethod: z.enum(['MOMO', 'CARD', 'BANK']),
  momoNetwork: z.enum(['MTN', 'TELECEL', 'AIRTELTIGO']).optional(),
  momoNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid MoMo number format').optional(),
});

export type PaymentInitiateInput = z.infer<typeof paymentInitiateSchema>;

// POST /payouts/initiate
export const payoutInitiateSchema = z.object({
  riderId: z.string().uuid('Invalid Rider UUID format'),
  amountMinor: z.number().int().positive('Amount must be a positive integer in minor units'),
});

export type PayoutInitiateInput = z.infer<typeof payoutInitiateSchema>;

// POST /payouts/verify
export const payoutVerifySchema = z.object({
  payoutId: z.string().uuid('Invalid Payout UUID format'),
  otpCode: z.string().length(6, 'OTP code must be exactly 6 digits'),
});

export type PayoutVerifyInput = z.infer<typeof payoutVerifySchema>;
