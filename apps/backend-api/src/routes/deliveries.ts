import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and, sql, desc } from '@dispatchpay/db';
import { 
  deliveries, 
  deliveryStatusHistory, 
  users, 
  riders, 
  wallets, 
  ledgerEntries 
} from '@dispatchpay/db';
import { db } from '@dispatchpay/db';
import { 
  createDeliverySchema, 
  updateDeliveryStatusSchema 
} from '@dispatchpay/types';
import crypto from 'crypto';

// Helper to generate tracking number: DP-YYYYMMDD-XXXX
function generateTrackingNumber(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase(); // 4-character hex
  return `DP-${dateStr}-${rand}`;
}

const deliveryRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // Require authentication for all delivery endpoints
  fastify.addHook('preValidation', fastify.authenticate);

  // ── 1. CREATE DELIVERY REQUEST ────────────────────────────────────────────
  fastify.post('/', {
    preValidation: [fastify.requireRole(['BUSINESS_OWNER', 'BUSINESS_MANAGER'])],
  }, async (request, reply) => {
    const bodyResult = createDeliverySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Validation failed',
        details: bodyResult.error.flatten().fieldErrors,
      });
    }

    const { 
      pickupAddress, 
      deliveryAddress, 
      pickupLatitude, 
      pickupLongitude, 
      deliveryLatitude, 
      deliveryLongitude, 
      distanceKm, 
      feeAmountMinor, 
      commissionAmountMinor, 
      riderId 
    } = bodyResult.data;

    const admin = request.user;
    const businessId = admin.businessId!;

    try {
      const payoutAmountMinor = feeAmountMinor - commissionAmountMinor;
      if (payoutAmountMinor < 0) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Commission amount cannot exceed total delivery fee amount.',
        });
      }

      // If riderId is provided, verify they belong to this business
      if (riderId) {
        const riderList = await db
          .select()
          .from(riders)
          .where(and(eq(riders.id, riderId), eq(riders.businessId, businessId)))
          .limit(1);

        if (riderList.length === 0) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Rider not found or does not belong to this business.',
          });
        }
      }

      const deliveryId = crypto.randomUUID();
      const status = riderId ? 'ASSIGNED' : 'PENDING';
      const trackingNumber = generateTrackingNumber();

      await db.transaction(async (tx) => {
        // 1. Insert delivery record
        await tx.insert(deliveries).values({
          id: deliveryId,
          businessId,
          riderId: riderId || null,
          trackingNumber,
          status,
          pickupAddress,
          deliveryAddress,
          pickupLatitude,
          pickupLongitude,
          deliveryLatitude,
          deliveryLongitude,
          distanceKm,
          feeAmountMinor,
          commissionAmountMinor,
          payoutAmountMinor,
        });

        // 2. Add history record
        const historyId = crypto.randomUUID();
        await tx.insert(deliveryStatusHistory).values({
          id: historyId,
          deliveryId,
          status,
          changedById: admin.id,
          notes: riderId ? 'Delivery created and rider assigned.' : 'Delivery created.',
        });
      });

      return reply.status(201).send({
        deliveryId,
        trackingNumber,
        status,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to create delivery.' });
    }
  });

  // ── 2. LIST DELIVERIES ────────────────────────────────────────────────────
  fastify.get('/', async (request, reply) => {
    const user = request.user;
    const query = request.query as any;

    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '10', 10);
    const status = query.status;
    const riderFilterId = query.riderId;
    const offset = (page - 1) * limit;

    try {
      const conditions = [];

      // Tenant isolation: filter by business ID
      if (user.businessId) {
        conditions.push(eq(deliveries.businessId, user.businessId));
      }

      // If user is RIDER, force filter to their own tasks only
      if (user.role === 'RIDER') {
        conditions.push(eq(deliveries.riderId, user.id));
      } else if (riderFilterId) {
        // Business admin querying a specific rider
        conditions.push(eq(deliveries.riderId, riderFilterId));
      }

      if (status) {
        conditions.push(eq(deliveries.status, status));
      }

      const finalCondition = and(...conditions);

      // Query data
      const data = await db
        .select({
          id: deliveries.id,
          trackingNumber: deliveries.trackingNumber,
          status: deliveries.status,
          pickupAddress: deliveries.pickupAddress,
          deliveryAddress: deliveries.deliveryAddress,
          payoutAmountMinor: deliveries.payoutAmountMinor,
          createdAt: deliveries.createdAt,
        })
        .from(deliveries)
        .where(finalCondition)
        .orderBy(desc(deliveries.createdAt))
        .limit(limit)
        .offset(offset);

      // Query count for pagination
      const countRes = await db
        .select({ count: sql<number>`count(*)` })
        .from(deliveries)
        .where(finalCondition);

      const totalItems = countRes[0]?.count || 0;
      const totalPages = Math.ceil(totalItems / limit);

      return reply.status(200).send({
        data,
        pagination: {
          page,
          limit,
          totalItems,
          totalPages,
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list deliveries.' });
    }
  });

  // ── 3. GET SINGLE DELIVERY DETAILS ────────────────────────────────────────
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as any;
    const user = request.user;

    try {
      const deliveryList = await db
        .select()
        .from(deliveries)
        .where(eq(deliveries.id, id))
        .limit(1);

      if (deliveryList.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Delivery task not found.' });
      }

      const delivery = deliveryList[0];

      // BOLA/IDOR Tenant Security Check
      if (user.role === 'RIDER') {
        if (delivery.riderId !== user.id) {
          return reply.status(403).send({ error: 'Forbidden', message: 'You are not assigned to this delivery.' });
        }
      } else {
        if (delivery.businessId !== user.businessId) {
          return reply.status(403).send({ error: 'Forbidden', message: 'This delivery does not belong to your business.' });
        }
      }

      return reply.status(200).send(delivery);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to retrieve delivery.' });
    }
  });

  // ── 4. ASSIGN RIDER ───────────────────────────────────────────────────────
  fastify.patch('/:id/assign', {
    preValidation: [fastify.requireRole(['BUSINESS_OWNER', 'BUSINESS_MANAGER'])],
  }, async (request, reply) => {
    const { id } = request.params as any;
    const body = request.body as any;
    const admin = request.user;

    const riderId = body.riderId;
    if (!riderId) {
      return reply.status(400).send({ error: 'Bad Request', message: 'riderId is required.' });
    }

    try {
      // 1. Fetch delivery
      const deliveryList = await db
        .select()
        .from(deliveries)
        .where(eq(deliveries.id, id))
        .limit(1);

      if (deliveryList.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Delivery task not found.' });
      }

      const delivery = deliveryList[0];

      // Security check
      if (delivery.businessId !== admin.businessId) {
        return reply.status(403).send({ error: 'Forbidden', message: 'This delivery does not belong to your business.' });
      }

      // Verify status allows assignment
      if (delivery.status !== 'PENDING' && delivery.status !== 'ASSIGNED') {
        return reply.status(400).send({
          error: 'Bad Request',
          message: `Cannot assign rider to delivery in '${delivery.status}' state.`,
        });
      }

      // 2. Verify rider belongs to this business
      const riderList = await db
        .select()
        .from(riders)
        .where(and(eq(riders.id, riderId), eq(riders.businessId, admin.businessId!)))
        .limit(1);

      if (riderList.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Rider not found in your business.' });
      }

      await db.transaction(async (tx) => {
        // Update delivery
        await tx
          .update(deliveries)
          .set({ riderId, status: 'ASSIGNED', updatedAt: new Date() })
          .where(eq(deliveries.id, id));

        // Add history log
        const historyId = crypto.randomUUID();
        await tx.insert(deliveryStatusHistory).values({
          id: historyId,
          deliveryId: id,
          status: 'ASSIGNED',
          changedById: admin.id,
          notes: 'Rider manually assigned by administrator.',
        });
      });

      return reply.status(200).send({
        deliveryId: id,
        riderId,
        status: 'ASSIGNED',
        message: 'Rider successfully assigned to delivery task.',
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to assign rider.' });
    }
  });

  // ── 5. UPDATE DELIVERY STATUS (STATE MACHINE & LEDGERING) ────────────────
  fastify.patch('/:id/status', async (request, reply) => {
    const { id } = request.params as any;
    const bodyResult = updateDeliveryStatusSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Validation failed',
        details: bodyResult.error.flatten().fieldErrors,
      });
    }

    const { status: targetStatus, latitude, longitude, notes } = bodyResult.data;
    const actor = request.user;

    try {
      // 1. Fetch delivery
      const deliveryList = await db
        .select()
        .from(deliveries)
        .where(eq(deliveries.id, id))
        .limit(1);

      if (deliveryList.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Delivery task not found.' });
      }

      const delivery = deliveryList[0];
      const currentStatus = delivery.status;

      // 2. Tenant & Assignment Security Checks
      if (actor.role === 'RIDER') {
        if (delivery.riderId !== actor.id) {
          return reply.status(403).send({ error: 'Forbidden', message: 'You are not assigned to this delivery.' });
        }
      } else {
        if (delivery.businessId !== actor.businessId) {
          return reply.status(403).send({ error: 'Forbidden', message: 'This delivery does not belong to your business.' });
        }
      }

      // 3. Strict State Machine Validation
      const isValidTransition = 
        (currentStatus === 'PENDING' && targetStatus === 'ASSIGNED') ||
        (currentStatus === 'ASSIGNED' && targetStatus === 'PICKED_UP') ||
        (currentStatus === 'PICKED_UP' && targetStatus === 'DELIVERED') ||
        (targetStatus === 'CANCELLED' && currentStatus !== 'DELIVERED' && currentStatus !== 'CANCELLED');

      if (!isValidTransition) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: `Invalid state transition: Cannot change status from '${currentStatus}' to '${targetStatus}'.`,
        });
      }

      // 4. Handle Lifecycle State Side Effects (Financial Ledgering on DELIVERED)
      if (targetStatus === 'DELIVERED') {
        if (!delivery.riderId) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Cannot mark delivery as delivered without an assigned rider.',
          });
        }

        // Run Ledgering and updates Atomically inside a transaction
        await db.transaction(async (tx) => {
          // A. Lock and Fetch Business Wallet (Overdraft Check)
          const bizWalletList = await tx
            .select()
            .from(wallets)
            .where(and(eq(wallets.ownerId, delivery.businessId), eq(wallets.ownerType, 'BUSINESS')))
            .limit(1);

          if (bizWalletList.length === 0) {
            throw new Error('BUSINESS_WALLET_NOT_FOUND');
          }

          const bizWallet = bizWalletList[0];
          
          if (bizWallet.balanceMinor < delivery.feeAmountMinor) {
            throw new Error('INSUFFICIENT_FUNDS');
          }

          // B. Lock and Fetch Rider Wallet
          const riderWalletList = await tx
            .select()
            .from(wallets)
            .where(and(eq(wallets.ownerId, delivery.riderId!), eq(wallets.ownerType, 'RIDER')))
            .limit(1);

          if (riderWalletList.length === 0) {
            throw new Error('RIDER_WALLET_NOT_FOUND');
          }

          const riderWallet = riderWalletList[0];

          // C. Calculate final balances
          const bizBalanceAfter = bizWallet.balanceMinor - delivery.feeAmountMinor;
          const riderBalanceAfter = riderWallet.balanceMinor + delivery.payoutAmountMinor;

          // D. Update Wallets
          await tx
            .update(wallets)
            .set({ balanceMinor: bizBalanceAfter, updatedAt: new Date() })
            .where(eq(wallets.id, bizWallet.id));

          await tx
            .update(wallets)
            .set({ balanceMinor: riderBalanceAfter, updatedAt: new Date() })
            .where(eq(wallets.id, riderWallet.id));

          // E. Insert Double-Entry Ledger Entries
          const bizLedgerId = crypto.randomUUID();
          await tx.insert(ledgerEntries).values({
            id: bizLedgerId,
            walletId: bizWallet.id,
            type: 'DEBIT',
            amountMinor: delivery.feeAmountMinor,
            balanceAfterMinor: bizBalanceAfter,
            referenceType: 'DELIVERY_FEE',
            referenceId: delivery.id,
            description: `Deduction for completed delivery tracking number ${delivery.trackingNumber}`,
          });

          const riderLedgerId = crypto.randomUUID();
          await tx.insert(ledgerEntries).values({
            id: riderLedgerId,
            walletId: riderWallet.id,
            type: 'CREDIT',
            amountMinor: delivery.payoutAmountMinor,
            balanceAfterMinor: riderBalanceAfter,
            referenceType: 'DELIVERY_COMMISSION',
            referenceId: delivery.id,
            description: `Payout credit for completed delivery tracking number ${delivery.trackingNumber}`,
          });

          // F. Update Delivery record
          await tx
            .update(deliveries)
            .set({ status: 'DELIVERED', updatedAt: new Date() })
            .where(eq(deliveries.id, id));

          // G. Add history log
          const historyId = crypto.randomUUID();
          await tx.insert(deliveryStatusHistory).values({
            id: historyId,
            deliveryId: id,
            status: 'DELIVERED',
            changedById: actor.id,
            latitude: latitude || null,
            longitude: longitude || null,
            notes: notes || 'Delivery completed successfully.',
          });
        });
      } else {
        // For transitions other than DELIVERED (e.g. PICKED_UP, CANCELLED)
        await db.transaction(async (tx) => {
          await tx
            .update(deliveries)
            .set({ status: targetStatus, updatedAt: new Date() })
            .where(eq(deliveries.id, id));

          const historyId = crypto.randomUUID();
          await tx.insert(deliveryStatusHistory).values({
            id: historyId,
            deliveryId: id,
            status: targetStatus,
            changedById: actor.id,
            latitude: latitude || null,
            longitude: longitude || null,
            notes: notes || null,
          });
        });
      }

      return reply.status(200).send({
        deliveryId: id,
        status: targetStatus,
        message: 'Delivery status transitioned successfully.',
      });

    } catch (err: any) {
      if (err.message === 'INSUFFICIENT_FUNDS') {
        return reply.status(402).send({
          error: 'Payment Required',
          message: 'Insufficient business wallet balance. Please top up your wallet to complete this delivery.',
        });
      }
      if (err.message === 'BUSINESS_WALLET_NOT_FOUND' || err.message === 'RIDER_WALLET_NOT_FOUND') {
        return reply.status(404).send({
          error: 'Not Found',
          message: err.message === 'BUSINESS_WALLET_NOT_FOUND' 
            ? 'Business wallet not found.' 
            : 'Rider wallet not found.',
        });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to update status.' });
    }
  });

  // ── 6. GET DELIVERY STATUS HISTORY ────────────────────────────────────────
  fastify.get('/:id/history', async (request, reply) => {
    const { id } = request.params as any;
    const user = request.user;

    try {
      // 1. Fetch delivery to verify tenant access
      const deliveryList = await db
        .select()
        .from(deliveries)
        .where(eq(deliveries.id, id))
        .limit(1);

      if (deliveryList.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Delivery task not found.' });
      }

      const delivery = deliveryList[0];

      // Tenant isolation check
      if (user.role === 'RIDER') {
        if (delivery.riderId !== user.id) {
          return reply.status(403).send({ error: 'Forbidden', message: 'You are not assigned to this delivery.' });
        }
      } else {
        if (delivery.businessId !== user.businessId) {
          return reply.status(403).send({ error: 'Forbidden', message: 'This delivery does not belong to your business.' });
        }
      }

      // Query history logs
      const history = await db
        .select({
          id: deliveryStatusHistory.id,
          status: deliveryStatusHistory.status,
          notes: deliveryStatusHistory.notes,
          latitude: deliveryStatusHistory.latitude,
          longitude: deliveryStatusHistory.longitude,
          createdAt: deliveryStatusHistory.createdAt,
          changedBy: {
            id: users.id,
            email: users.email,
            phoneNumber: users.phoneNumber,
            role: users.role,
          }
        })
        .from(deliveryStatusHistory)
        .innerJoin(users, eq(deliveryStatusHistory.changedById, users.id))
        .where(eq(deliveryStatusHistory.deliveryId, id))
        .orderBy(desc(deliveryStatusHistory.createdAt));

      return reply.status(200).send(history);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to retrieve delivery history.' });
    }
  });

};

export default deliveryRoutes;
