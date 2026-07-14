import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and } from '@dispatchpay/db';
import { riders, users, wallets, payouts, ledgerEntries, otpVerifications, smsLogs } from '@dispatchpay/db';
import { db } from '@dispatchpay/db';
import { payoutInitiateSchema, payoutVerifySchema } from '@dispatchpay/types';
import { generateOtp, hashOtp } from '../utils/crypto';
import crypto from 'crypto';

const payoutRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // ── 1. INITIATE PAYOUT (Business triggers payout to a rider) ──────────────
  fastify.post(
    '/initiate',
    { preValidation: [fastify.authenticate, fastify.requireRole(['BUSINESS_OWNER', 'BUSINESS_MANAGER'])] },
    async (request, reply) => {
      const bodyResult = payoutInitiateSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Validation failed',
          details: bodyResult.error.flatten().fieldErrors,
        });
      }

      const { riderId, amountMinor } = bodyResult.data;
      const actor = request.user;

      if (!actor.businessId) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Must be linked to a business.' });
      }

      try {
        const result = await db.transaction(async (tx) => {
          // Validate rider belongs to this business
          const riderList = await tx
            .select()
            .from(riders)
            .where(and(eq(riders.id, riderId), eq(riders.businessId, actor.businessId!)))
            .limit(1);

          if (riderList.length === 0) {
            throw new Error('RIDER_NOT_FOUND');
          }

          const rider = riderList[0];

          // Get rider user for phone number
          const riderUserList = await tx.select().from(users).where(eq(users.id, riderId)).limit(1);
          if (riderUserList.length === 0) throw new Error('RIDER_USER_NOT_FOUND');
          const riderUser = riderUserList[0];

          if (!riderUser.phoneNumber) throw new Error('RIDER_NO_PHONE');

          // Check business wallet has sufficient balance
          const walletList = await tx
            .select()
            .from(wallets)
            .where(and(eq(wallets.ownerId, actor.businessId!), eq(wallets.ownerType, 'BUSINESS')))
            .limit(1);

          if (walletList.length === 0) throw new Error('WALLET_NOT_FOUND');
          const wallet = walletList[0];

          if (wallet.balanceMinor < amountMinor) {
            throw new Error('INSUFFICIENT_BALANCE');
          }

          // Create payout record (PENDING — awaits OTP verification)
          const payoutId = crypto.randomUUID();
          await tx.insert(payouts).values({
            id: payoutId,
            businessId: actor.businessId!,
            riderId,
            amountMinor,
            currency: 'GHS',
            status: 'PENDING',
            recipientPhone: rider.momoNumber,
            recipientNetwork: rider.momoNetwork,
          });

          // Generate OTP for authorization
          const rawOtp = generateOtp();
          const otpHash = hashOtp(rawOtp);
          const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
          const otpId = crypto.randomUUID();

          await tx.insert(otpVerifications).values({
            id: otpId,
            phoneNumber: riderUser.phoneNumber!,
            code: otpHash,
            purpose: 'PAYOUT_VERIFICATION',
            status: 'PENDING',
            expiresAt,
          });

          await tx.insert(smsLogs).values({
            id: crypto.randomUUID(),
            phoneNumber: riderUser.phoneNumber!,
            message: `Your DispatchPay payout authorisation code is ${rawOtp}. Valid for 5 minutes.`,
            status: 'SENT',
          });

          fastify.log.info(`[SANDBOX OTP] Payout: ${payoutId} | Rider: ${riderUser.phoneNumber} | OTP: ${rawOtp}`);

          return { payoutId, otpId };
        });

        return reply.status(202).send({
          payoutId: result.payoutId,
          otpId: result.otpId,
          message: 'Payout initiated. OTP sent to rider for authorisation.',
        });
      } catch (err: any) {
        if (err.message === 'RIDER_NOT_FOUND') return reply.status(404).send({ error: 'Not Found', message: 'Rider not found in this business.' });
        if (err.message === 'INSUFFICIENT_BALANCE') return reply.status(422).send({ error: 'Unprocessable Entity', message: 'Insufficient wallet balance.' });
        if (err.message === 'RIDER_NO_PHONE') return reply.status(422).send({ error: 'Unprocessable Entity', message: 'Rider has no phone number on record.' });
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to initiate payout.' });
      }
    }
  );

  // ── 2. VERIFY PAYOUT (Rider authorises with OTP) ──────────────────────────
  fastify.post('/verify', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const bodyResult = payoutVerifySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Validation failed',
        details: bodyResult.error.flatten().fieldErrors,
      });
    }

    const { payoutId, otpCode } = bodyResult.data;
    const actor = request.user;
    const codeHash = hashOtp(otpCode);

    try {
      await db.transaction(async (tx) => {
        const payoutList = await tx.select().from(payouts).where(eq(payouts.id, payoutId)).limit(1);
        if (payoutList.length === 0) throw new Error('PAYOUT_NOT_FOUND');
        const payout = payoutList[0];

        if (payout.status !== 'PENDING') throw new Error('PAYOUT_NOT_PENDING');

        // Verify caller is the rider or a business admin
        if (actor.role === 'RIDER' && actor.id !== payout.riderId) {
          throw new Error('FORBIDDEN');
        }

        const riderUserList = await tx.select().from(users).where(eq(users.id, payout.riderId)).limit(1);
        if (riderUserList.length === 0) throw new Error('RIDER_NOT_FOUND');
        const riderUser = riderUserList[0];

        // Validate OTP
        const otpList = await tx
          .select()
          .from(otpVerifications)
          .where(
            and(
              eq(otpVerifications.phoneNumber, riderUser.phoneNumber!),
              eq(otpVerifications.code, codeHash),
              eq(otpVerifications.purpose, 'PAYOUT_VERIFICATION'),
              eq(otpVerifications.status, 'PENDING')
            )
          )
          .limit(1);

        if (otpList.length === 0) throw new Error('INVALID_OTP');

        const otp = otpList[0];
        if (new Date() > otp.expiresAt) {
          await tx.update(otpVerifications).set({ status: 'EXPIRED' }).where(eq(otpVerifications.id, otp.id));
          throw new Error('EXPIRED_OTP');
        }

        await tx.update(otpVerifications).set({ status: 'VERIFIED' }).where(eq(otpVerifications.id, otp.id));

        // Debit business wallet
        const businessWalletList = await tx
          .select()
          .from(wallets)
          .where(and(eq(wallets.ownerId, payout.businessId), eq(wallets.ownerType, 'BUSINESS')))
          .limit(1);

        if (businessWalletList.length === 0) throw new Error('WALLET_NOT_FOUND');
        const businessWallet = businessWalletList[0];

        if (businessWallet.balanceMinor < payout.amountMinor) throw new Error('INSUFFICIENT_BALANCE');

        const newBusinessBalance = businessWallet.balanceMinor - payout.amountMinor;
        await tx.update(wallets).set({ balanceMinor: newBusinessBalance }).where(eq(wallets.id, businessWallet.id));

        await tx.insert(ledgerEntries).values({
          id: crypto.randomUUID(),
          walletId: businessWallet.id,
          type: 'DEBIT',
          amountMinor: payout.amountMinor,
          balanceAfterMinor: newBusinessBalance,
          referenceType: 'PAYOUT',
          referenceId: payout.id,
          description: `Payout to rider ${payout.riderId}`,
        });

        // Credit rider wallet
        const riderWalletList = await tx
          .select()
          .from(wallets)
          .where(and(eq(wallets.ownerId, payout.riderId), eq(wallets.ownerType, 'RIDER')))
          .limit(1);

        if (riderWalletList.length > 0) {
          const riderWallet = riderWalletList[0];
          const newRiderBalance = riderWallet.balanceMinor + payout.amountMinor;
          await tx.update(wallets).set({ balanceMinor: newRiderBalance }).where(eq(wallets.id, riderWallet.id));

          await tx.insert(ledgerEntries).values({
            id: crypto.randomUUID(),
            walletId: riderWallet.id,
            type: 'CREDIT',
            amountMinor: payout.amountMinor,
            balanceAfterMinor: newRiderBalance,
            referenceType: 'PAYOUT',
            referenceId: payout.id,
            description: 'Delivery payout received',
          });
        }

        // Dispatch via Moolre
        const providerResp = await fastify.moolre.initiatePayout({
          amountMinor: payout.amountMinor,
          currency: payout.currency,
          recipientNetwork: payout.recipientNetwork,
          recipientPhone: payout.recipientPhone,
          referenceId: payout.id,
          description: `DispatchPay payout ${payout.id}`,
        });

        await tx.update(payouts).set({
          status: 'PROCESSING',
          providerReference: providerResp.providerReference,
        }).where(eq(payouts.id, payout.id));
      });

      return reply.status(200).send({ message: 'Payout authorised and dispatched.' });
    } catch (err: any) {
      if (err.message === 'PAYOUT_NOT_FOUND') return reply.status(404).send({ error: 'Not Found', message: 'Payout not found.' });
      if (err.message === 'PAYOUT_NOT_PENDING') return reply.status(409).send({ error: 'Conflict', message: 'Payout is no longer pending.' });
      if (err.message === 'INVALID_OTP') return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid OTP code.' });
      if (err.message === 'EXPIRED_OTP') return reply.status(401).send({ error: 'Unauthorized', message: 'OTP has expired.' });
      if (err.message === 'INSUFFICIENT_BALANCE') return reply.status(422).send({ error: 'Unprocessable Entity', message: 'Insufficient balance.' });
      if (err.message === 'FORBIDDEN') return reply.status(403).send({ error: 'Forbidden', message: 'Not authorised for this payout.' });
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Payout verification failed.' });
    }
  });

  // ── 3. PAYOUT WEBHOOK (Moolre calls this on disbursement status change) ────
  fastify.post('/webhook', async (request, reply) => {
    const signature = (request.headers['x-moolre-signature'] as string) || '';
    if (!fastify.moolre.verifyWebhookSignature(JSON.stringify(request.body), signature)) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid webhook signature.' });
    }

    const payload = request.body as { providerReference: string; status: 'SUCCESS' | 'FAILED'; errorMessage?: string };

    try {
      const payoutList = await db.select().from(payouts).where(eq(payouts.providerReference, payload.providerReference)).limit(1);
      if (payoutList.length === 0) return reply.status(200).send({ received: true });

      const payout = payoutList[0];
      if (payout.status !== 'PROCESSING') return reply.status(200).send({ received: true });

      const newStatus = payload.status === 'SUCCESS' ? 'COMPLETED' : 'FAILED';
      await db.update(payouts).set({
        status: newStatus,
        errorMessage: payload.status === 'FAILED' ? (payload.errorMessage || 'Provider disbursement failed') : undefined,
      }).where(eq(payouts.id, payout.id));

      return reply.status(200).send({ received: true });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Webhook processing failed.' });
    }
  });

  // ── 4. LIST PAYOUTS FOR BUSINESS ──────────────────────────────────────────
  fastify.get(
    '/',
    { preValidation: [fastify.authenticate, fastify.requireRole(['BUSINESS_OWNER', 'BUSINESS_MANAGER'])] },
    async (request, reply) => {
      const actor = request.user;
      if (!actor.businessId) return reply.status(403).send({ error: 'Forbidden', message: 'Must be linked to a business.' });

      const payoutList = await db.select().from(payouts).where(eq(payouts.businessId, actor.businessId));
      return reply.status(200).send(payoutList);
    }
  );
};

export default payoutRoutes;
