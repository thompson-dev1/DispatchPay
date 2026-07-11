import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and, desc } from '@dispatchpay/db';
import { businesses, wallets, ledgerEntries } from '@dispatchpay/db';
import { db } from '@dispatchpay/db';

const businessRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // Require authentication and ensure role is business admin
  fastify.addHook('preValidation', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireRole(['BUSINESS_OWNER', 'BUSINESS_MANAGER']));

  // ── 1. GET CURRENT BUSINESS PROFILE ───────────────────────────────────────
  fastify.get('/me', async (request, reply) => {
    const user = request.user;
    const businessId = user.businessId;

    if (!businessId) {
      return reply.status(400).send({ error: 'Bad Request', message: 'User is not linked to any business.' });
    }

    try {
      const bizList = await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .limit(1);

      if (bizList.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Business profile not found.' });
      }

      return reply.status(200).send(bizList[0]);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to retrieve business details.' });
    }
  });

  // ── 2. GET BUSINESS WALLET AND LEDGER HISTORY ──────────────────────────────
  fastify.get('/me/wallet', async (request, reply) => {
    const user = request.user;
    const businessId = user.businessId;

    if (!businessId) {
      return reply.status(400).send({ error: 'Bad Request', message: 'User is not linked to any business.' });
    }

    try {
      // 1. Fetch wallet
      const walletList = await db
        .select()
        .from(wallets)
        .where(and(eq(wallets.ownerId, businessId), eq(wallets.ownerType, 'BUSINESS')))
        .limit(1);

      if (walletList.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Business wallet not found.' });
      }

      const wallet = walletList[0];

      // 2. Fetch recent ledger records (limit to 50 for quick preview)
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
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to retrieve wallet details.' });
    }
  });

};

export default businessRoutes;
