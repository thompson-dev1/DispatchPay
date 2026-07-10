import { z } from 'zod';

export const createDeliverySchema = z.object({
  pickupAddress: z.string().min(5),
  deliveryAddress: z.string().min(5),
  feeAmountMinor: z.number().int().positive(),
  commissionAmountMinor: z.number().int().positive(),
  riderId: z.string().uuid().optional(),
});

export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;

export const userRoleSchema = z.enum([
  'SUPER_ADMIN',
  'BUSINESS_OWNER',
  'BUSINESS_MANAGER',
  'RIDER',
]);

export type UserRole = z.infer<typeof userRoleSchema>;
