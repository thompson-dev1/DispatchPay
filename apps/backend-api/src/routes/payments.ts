import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and } from '@dispatchpay/db';
import { payments, payouts, wallets, ledgerEntries } from '@dispatchpay/db';
import { db } from '@dispatchpay/db';
import { paymentInitiateSchema } from '@dispatchpay/types';
import crypto from 'crypto';

const paymentRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // ── 1. INITIATE WALLET FUNDING ────────────────────────────────────────────
  fastify.post('/fund-wallet', {
    preValidation: [
      fastify.authenticate,
      fastify.requireRole(['BUSINESS_OWNER']),
    ],
  }, async (request, reply) => {
    const bodyResult = paymentInitiateSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Validation failed',
        details: bodyResult.error.flatten().fieldErrors,
      });
    }

    const { amountMinor, paymentMethod, momoNetwork, momoNumber } = bodyResult.data;
    const admin = request.user;
    const businessId = admin.businessId!;

    try {
      const paymentId = crypto.randomUUID();
      const referenceId = `pay_${crypto.randomBytes(6).toString('hex')}`;

      // Call Moolre Payments API to collect funding
      const collectRes = await fastify.moolre.fundWallet({
        amountMinor,
        paymentMethod,
        network: momoNetwork,
        phoneNumber: momoNumber,
        referenceId,
      });

      // Insert pending payment record in DB
      await db.insert(payments).values({
        id: paymentId,
        businessId,
        amountMinor,
        currency: 'GHS',
        status: 'PENDING',
        paymentMethod,
        providerReference: collectRes.providerReference,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return reply.status(202).send({
        paymentId,
        status: 'PENDING',
        providerReference: collectRes.providerReference,
        message: 'Funding request initiated. Please approve the MoMo prompt on your phone.',
      });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: err.message || 'Failed to initiate funding.' });
    }
  });

  // ── 2. MOOLRE WEBHOOK RECEIVER (PUBLIC ENDPOINT) ─────────────────────────
  fastify.post('/webhook/moolre', {
    // Override default JSON parser to get raw body buffer for signature check
    config: {
      rawBody: true
    }
  }, async (request, reply) => {
    const signature = request.headers['x-moolre-signature'] as string;
    if (!signature) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Missing signature header' });
    }

    // Fastify-raw-body plugin would populate rawBody. Since we don't have it configured,
    // we can parse payload from string body, but for verification reliability in production,
    // raw body is needed. Here we fallback to string body if rawBody is not present.
    const rawPayload = (request as any).rawBody || JSON.stringify(request.body);

    const isValid = fastify.moolre.verifyWebhookSignature(rawPayload, signature);
    if (!isValid) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid signature signature verification failed.' });
    }

    const event = request.body as any;
    const providerReference = event.reference || event.id;
    const eventStatus = event.status; // 'success' | 'failed'

    if (!providerReference) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Reference missing in webhook event.' });
    }

    try {
      // Look up if this reference matches an Inbound Payment (Funding)
      const paymentList = await db
        .select()
        .from(payments)
        .where(eq(payments.providerReference, providerReference))
        .limit(1);

      if (paymentList.length > 0) {
        const paymentRecord = paymentList[0];

        // Prevent double processing
        if (paymentRecord.status !== 'PENDING') {
          return reply.status(200).send({ received: true, duplicate: true });
        }

        if (eventStatus === 'success') {
          // Atomic transaction to update status & credit wallet
          await db.transaction(async (tx) => {
            // Lock and get business wallet
            const walletList = await tx
              .select()
              .from(wallets)
              .where(and(eq(wallets.ownerId, paymentRecord.businessId), eq(wallets.ownerType, 'BUSINESS')))
              .limit(1);

            if (walletList.length === 0) {
              throw new Error('WALLET_NOT_FOUND');
            }

            const wallet = walletList[0];
            const balanceAfter = wallet.balanceMinor + paymentRecord.amountMinor;

            // 1. Update wallet balance
            await tx
              .update(wallets)
              .set({ balanceMinor: balanceAfter, updatedAt: new Date() })
              .where(eq(wallets.id, wallet.id));

            // 2. Insert credit ledger log
            const ledgerId = crypto.randomUUID();
            await tx.insert(ledgerEntries).values({
              id: ledgerId,
              walletId: wallet.id,
              type: 'CREDIT',
              amountMinor: paymentRecord.amountMinor,
              balanceAfterMinor: balanceAfter,
              referenceType: 'PAYMENT',
              referenceId: paymentRecord.id,
              description: 'Inward mobile money wallet funding.',
            });

            // 3. Update payment record to SUCCESS
            await tx
              .update(payments)
              .set({ status: 'SUCCESS', updatedAt: new Date() })
              .where(eq(payments.id, paymentRecord.id));
          });

          fastify.log.info(`[Webhook Success] Credited Wallet for business: ${paymentRecord.businessId} | Amount: ${paymentRecord.amountMinor}`);
        } else {
          // If payment failed
          await db
            .update(payments)
            .set({ status: 'FAILED', updatedAt: new Date() })
            .where(eq(payments.id, paymentRecord.id));
        }

        return reply.status(200).send({ received: true, processed: true });
      }

      // Check if this reference matches an Outbound Payout (Transfer)
      const payoutList = await db
        .select()
        .from(payouts)
        .where(eq(payouts.providerReference, providerReference))
        .limit(1);

      if (payoutList.length > 0) {
        const payoutRecord = payoutList[0];

        // Prevent double processing
        if (payoutRecord.status !== 'PROCESSING') {
          return reply.status(200).send({ received: true, duplicate: true });
        }

        if (eventStatus === 'success') {
          // Lock transfer as permanent SUCCESS
          await db
            .update(payouts)
            .set({ status: 'SUCCESS', updatedAt: new Date() })
            .where(eq(payouts.id, payoutRecord.id));

          fastify.log.info(`[Webhook Success] Payout confirmed for rider: ${payoutRecord.riderId} | Amount: ${payoutRecord.amountMinor}`);
        } else {
          // Webhook reported FAILED transfer -> roll back (unlock) rider wallet funds!
          await db.transaction(async (tx) => {
            const walletList = await tx
              .select()
              .from(wallets)
              .where(and(eq(wallets.ownerId, payoutRecord.riderId), eq(wallets.ownerType, 'RIDER')))
              .limit(1);

            if (walletList.length === 0) {
              throw new Error('WALLET_NOT_FOUND');
            }

            const wallet = walletList[0];
            const balanceAfter = wallet.balanceMinor + payoutRecord.amountMinor;

            // 1. Return payout funds back to rider balance
            await tx
              .update(wallets)
              .set({ balanceMinor: balanceAfter, updatedAt: new Date() })
              .where(eq(wallets.id, wallet.id));

            // 2. Add ledger refund credit entry
            const ledgerId = crypto.randomUUID();
            await tx.insert(ledgerEntries).values({
              id: ledgerId,
              walletId: wallet.id,
              type: 'CREDIT',
              amountMinor: payoutRecord.amountMinor,
              balanceAfterMinor: balanceAfter,
              referenceType: 'WALLET_ADJUSTMENT',
              referenceId: payoutRecord.id,
              description: `Refund for failed payout transfer (Moolre error: ${event.errorMessage || 'declined'})`,
            });

            // 3. Mark payout status as FAILED
            await tx
              .update(payouts)
              .set({ 
                status: 'FAILED', 
                errorMessage: event.errorMessage || 'Transfer declined by provider.', 
                updatedAt: new Date() 
              })
              .where(eq(payouts.id, payoutRecord.id));
          });
        }

        return reply.status(200).send({ received: true, processed: true });
      }

      // If reference matches nothing
      return reply.status(404).send({ error: 'Not Found', message: 'Transaction reference not matched.' });

    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to process webhook.' });
    }
  });

};

export default paymentRoutes;
