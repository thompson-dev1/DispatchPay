import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq } from '@dispatchpay/db';
import { businesses, wallets, payments, ledgerEntries } from '@dispatchpay/db';
import { db } from '@dispatchpay/db';
import { paymentInitiateSchema } from '@dispatchpay/types';
import crypto from 'crypto';

const paymentRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // ── 1. INITIATE PAYMENT (Business funds wallet via MoMo) ──────────────────
  fastify.post(
    '/initiate',
    { preValidation: [fastify.authenticate, fastify.requireRole(['BUSINESS_OWNER', 'BUSINESS_MANAGER'])] },
    async (request, reply) => {
      const bodyResult = paymentInitiateSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Validation failed',
          details: bodyResult.error.flatten().fieldErrors,
        });
      }

      const { amountMinor, paymentMethod, momoNetwork, momoNumber } = bodyResult.data;
      const actor = request.user;

      if (!actor.businessId) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Must be linked to a business.' });
      }

      if (paymentMethod === 'MOMO' && (!momoNetwork || !momoNumber)) {
        return reply.status(400).send({ error: 'Bad Request', message: 'momoNetwork and momoNumber required for MOMO payments.' });
      }

      try {
        const businessList = await db.select().from(businesses).where(eq(businesses.id, actor.businessId)).limit(1);
        if (businessList.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Business not found.' });
        }

        const paymentId = crypto.randomUUID();

        // Initiate via Moolre gateway (sandbox)
        const providerResp = await fastify.moolre.initiatePayment({
          amountMinor,
          currency: 'GHS',
          momoNetwork: (momoNetwork || 'MTN') as 'MTN' | 'TELECEL' | 'AIRTELTIGO',
          momoNumber: momoNumber || '',
          referenceId: paymentId,
          description: `Wallet top-up for business ${actor.businessId}`,
        });

        await db.insert(payments).values({
          id: paymentId,
          businessId: actor.businessId,
          amountMinor,
          currency: 'GHS',
          status: 'PENDING',
          paymentMethod,
          providerReference: providerResp.providerReference,
        });

        return reply.status(202).send({
          paymentId,
          providerReference: providerResp.providerReference,
          status: 'PENDING',
          message: 'Payment initiated. Wallet will be credited upon confirmation.',
        });
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to initiate payment.' });
      }
    }
  );

  // ── 2. PAYMENT WEBHOOK (Moolre calls this on status change) ───────────────
  fastify.post('/webhook', async (request, reply) => {
    const signature = (request.headers['x-moolre-signature'] as string) || '';
    const rawBody = JSON.stringify(request.body);

    if (!fastify.moolre.verifyWebhookSignature(rawBody, signature)) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid webhook signature.' });
    }

    const payload = request.body as { providerReference: string; status: 'SUCCESS' | 'FAILED'; amountMinor?: number };

    try {
      const paymentList = await db
        .select()
        .from(payments)
        .where(eq(payments.providerReference, payload.providerReference))
        .limit(1);

      if (paymentList.length === 0) {
        fastify.log.warn(`Webhook for unknown payment ref: ${payload.providerReference}`);
        return reply.status(200).send({ received: true });
      }

      const payment = paymentList[0];

      if (payment.status !== 'PENDING') {
        return reply.status(200).send({ received: true }); // idempotent
      }

      await db.transaction(async (tx) => {
        const newStatus = payload.status === 'SUCCESS' ? 'COMPLETED' : 'FAILED';
        await tx.update(payments).set({ status: newStatus }).where(eq(payments.id, payment.id));

        if (payload.status === 'SUCCESS') {
          // Credit business wallet
          const walletList = await tx
            .select()
            .from(wallets)
            .where(eq(wallets.ownerId, payment.businessId))
            .limit(1);

          if (walletList.length > 0) {
            const wallet = walletList[0];
            const newBalance = wallet.balanceMinor + payment.amountMinor;
            await tx.update(wallets).set({ balanceMinor: newBalance }).where(eq(wallets.id, wallet.id));

            await tx.insert(ledgerEntries).values({
              id: crypto.randomUUID(),
              walletId: wallet.id,
              type: 'CREDIT',
              amountMinor: payment.amountMinor,
              balanceAfterMinor: newBalance,
              referenceType: 'PAYMENT',
              referenceId: payment.id,
              description: `Payment via ${payment.paymentMethod}`,
            });
          }
        }
      });

      return reply.status(200).send({ received: true });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Webhook processing failed.' });
    }
  });

  // ── 3. GET PAYMENT STATUS ─────────────────────────────────────────────────
  fastify.get(
    '/:paymentId',
    { preValidation: [fastify.authenticate, fastify.requireRole(['BUSINESS_OWNER', 'BUSINESS_MANAGER'])] },
    async (request, reply) => {
      const { paymentId } = request.params as { paymentId: string };
      const actor = request.user;

      const paymentList = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
      if (paymentList.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Payment not found.' });
      }

      const payment = paymentList[0];
      if (payment.businessId !== actor.businessId) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Access denied.' });
      }

      return reply.status(200).send(payment);
    }
  );

  // ── 4. LIST PAYMENTS FOR BUSINESS ─────────────────────────────────────────
  fastify.get(
    '/',
    { preValidation: [fastify.authenticate, fastify.requireRole(['BUSINESS_OWNER', 'BUSINESS_MANAGER'])] },
    async (request, reply) => {
      const actor = request.user;
      if (!actor.businessId) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Must be linked to a business.' });
      }

      const paymentList = await db
        .select()
        .from(payments)
        .where(eq(payments.businessId, actor.businessId));

      return reply.status(200).send(paymentList);
    }
  );
};

export default paymentRoutes;
