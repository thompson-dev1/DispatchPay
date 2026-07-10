import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and, sql, desc } from '@dispatchpay/db';
import { users, riders, wallets, ledgerEntries } from '@dispatchpay/db';
import { db } from '@dispatchpay/db';
import { riderRegisterSchema } from '@dispatchpay/types';

// Create a partial patch validation schema for update
import { z } from 'zod';
const updateRiderSchema = riderRegisterSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const riderRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // Require authentication
  fastify.addHook('preValidation', fastify.authenticate);

  // ── 1. LIST BUSINESS RIDERS ───────────────────────────────────────────────
  fastify.get('/', {
    preValidation: [fastify.requireRole(['BUSINESS_OWNER', 'BUSINESS_MANAGER'])],
  }, async (request, reply) => {
    const admin = request.user;
    const query = request.query as any;

    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '10', 10);
    const isActive = query.isActive !== undefined ? query.isActive === 'true' : undefined;
    const offset = (page - 1) * limit;

    try {
      const conditions = [eq(users.businessId, admin.businessId!)];
      
      if (isActive !== undefined) {
        conditions.push(eq(users.isActive, isActive));
      }

      const finalCondition = and(...conditions);

      // Query data using join
      const data = await db
        .select({
          id: riders.id,
          firstName: riders.firstName,
          lastName: riders.lastName,
          phoneNumber: users.phoneNumber,
          vehicleType: riders.vehicleType,
          vehiclePlate: riders.vehiclePlate,
          momoNetwork: riders.momoNetwork,
          isActive: users.isActive,
        })
        .from(riders)
        .innerJoin(users, eq(riders.id, users.id))
        .where(finalCondition)
        .orderBy(desc(riders.createdAt))
        .limit(limit)
        .offset(offset);

      // Query count
      const countRes = await db
        .select({ count: sql<number>`count(*)` })
        .from(riders)
        .innerJoin(users, eq(riders.id, users.id))
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
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list riders.' });
    }
  });

  // ── 2. GET SINGLE RIDER DETAILS ───────────────────────────────────────────
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as any;
    const currentUser = request.user;

    // Security check: Rider can check their own profile, admins can check their tenant's riders
    if (currentUser.role === 'RIDER' && currentUser.id !== id) {
      return reply.status(403).send({ error: 'Forbidden', message: 'You are not authorized to view this profile.' });
    }

    try {
      const riderList = await db
        .select({
          id: riders.id,
          businessId: riders.businessId,
          firstName: riders.firstName,
          lastName: riders.lastName,
          phoneNumber: users.phoneNumber,
          vehicleType: riders.vehicleType,
          vehiclePlate: riders.vehiclePlate,
          momoNetwork: riders.momoNetwork,
          momoNumber: riders.momoNumber,
          isActive: users.isActive,
          createdAt: riders.createdAt,
        })
        .from(riders)
        .innerJoin(users, eq(riders.id, users.id))
        .where(eq(riders.id, id))
        .limit(1);

      if (riderList.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Rider not found.' });
      }

      const riderProfile = riderList[0];

      // Tenant isolation security check
      if (currentUser.role !== 'RIDER' && riderProfile.businessId !== currentUser.businessId) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Rider does not belong to your business.' });
      }

      return reply.status(200).send(riderProfile);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to retrieve rider details.' });
    }
  });

  // ── 3. UPDATE RIDER PROFILE ───────────────────────────────────────────────
  fastify.patch('/:id', {
    preValidation: [fastify.requireRole(['BUSINESS_OWNER', 'BUSINESS_MANAGER'])],
  }, async (request, reply) => {
    const { id } = request.params as any;
    const bodyResult = updateRiderSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Validation failed',
        details: bodyResult.error.flatten().fieldErrors,
      });
    }

    const updates = bodyResult.data;
    const admin = request.user;

    try {
      // 1. Fetch rider
      const riderList = await db
        .select()
        .from(riders)
        .where(eq(riders.id, id))
        .limit(1);

      if (riderList.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Rider not found.' });
      }

      const riderRecord = riderList[0];

      // Tenant security check
      if (riderRecord.businessId !== admin.businessId) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Rider does not belong to your business.' });
      }

      // 2. Perform updates inside transaction
      await db.transaction(async (tx) => {
        // Update user active status if provided
        if (updates.isActive !== undefined) {
          await tx
            .update(users)
            .set({ isActive: updates.isActive, updatedAt: new Date() })
            .where(eq(users.id, id));
        }

        // Update rider profile details
        const profileUpdates: any = {};
        if (updates.firstName) profileUpdates.firstName = updates.firstName;
        if (updates.lastName) profileUpdates.lastName = updates.lastName;
        if (updates.vehicleType) profileUpdates.vehicleType = updates.vehicleType;
        if (updates.vehiclePlate !== undefined) profileUpdates.vehiclePlate = updates.vehiclePlate;
        if (updates.momoNetwork) profileUpdates.momoNetwork = updates.momoNetwork;
        if (updates.momoNumber) profileUpdates.momoNumber = updates.momoNumber;

        if (Object.keys(profileUpdates).length > 0) {
          profileUpdates.updatedAt = new Date();
          await tx
            .update(riders)
            .set(profileUpdates)
            .where(eq(riders.id, id));
        }
      });

      return reply.status(200).send({
        id,
        message: 'Rider profile updated successfully.',
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to update rider profile.' });
    }
  });

  // ── 4. GET RIDER WALLET AND LEDGER HISTORY ────────────────────────────────
  fastify.get('/:id/wallet', async (request, reply) => {
    const { id } = request.params as any;
    const currentUser = request.user;

    // Security check: Rider can check their own wallet, admins can check their tenant's riders
    if (currentUser.role === 'RIDER' && currentUser.id !== id) {
      return reply.status(403).send({ error: 'Forbidden', message: 'You are not authorized to view this wallet.' });
    }

    try {
      // 1. Fetch wallet
      const walletList = await db
        .select()
        .from(wallets)
        .where(and(eq(wallets.ownerId, id), eq(wallets.ownerType, 'RIDER')))
        .limit(1);

      if (walletList.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Rider wallet not found.' });
      }

      const wallet = walletList[0];

      // Tenant check: ensure rider belongs to the admin's business
      if (currentUser.role !== 'RIDER') {
        const riderList = await db
          .select()
          .from(riders)
          .where(eq(riders.id, id))
          .limit(1);

        if (riderList.length === 0 || riderList[0].businessId !== currentUser.businessId) {
          return reply.status(403).send({ error: 'Forbidden', message: 'Rider does not belong to your business.' });
        }
      }

      // 2. Fetch ledger history
      const ledger = await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.walletId, wallet.id))
        .orderBy(desc(ledgerEntries.createdAt))
        .limit(50);

      return reply.status(200).send({
        walletId: wallet.id,
        balanceMinor: wallet.balanceMinor,
        currency: wallet.currency,
        updatedAt: wallet.updatedAt,
        ledger,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to retrieve rider wallet.' });
    }
  });

};

export default riderRoutes;
