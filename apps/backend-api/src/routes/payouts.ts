import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and } from '@dispatchpay/db';
import { 
  payouts, 
  riders, 
  users,
  wallets, 
  ledgerEntries, 
  otpVerifications, 
  smsLogs 
} from '@dispatchpay/db';
import { db } from '@dispatchpay/db';
import { payoutInitiateSchema, payoutVerifySchema } from '@dispatchpay/types';
import { generateOtp, hashOtp } from '../utils/crypto';
import crypto from 'crypto';

const payoutRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // Require authentication for all payout endpoints
  fastify.addHook('preValidation', fastify.authenticate);

  // ── 1. INITIATE OUTWARD PAYOUT (LOCKS FUNDS & SENDS OTP) ─────────────────
  fastify.post('/initiate', async (request, reply) => {
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

    // Security check: Rider can only pay out to themselves; admin can trigger payouts for their riders
    if (actor.role === 'RIDER' && actor.id !== riderId) {
      return reply.status(403).send({ error: 'Forbidden', message: 'You can only initiate payouts for yourself.' });
    }

    try {
      // 1. Fetch Rider Profile & User details
      const riderList = await db
        .select({
          id: riders.id,
          businessId: riders.businessId,
          phoneNumber: users.phoneNumber,
          momoNumber: riders.momoNumber,
          momoNetwork: riders.momoNetwork,
        })
        .from(riders)
        .innerJoin(users, eq(riders.id, users.id))
        .where(eq(riders.id, riderId))
        .limit(1);

      if (riderList.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Rider profile not found.' });
      }

      const rider = riderList[0];

      // Tenant isolation check for admins
      if (actor.role !== 'RIDER' && rider.businessId !== actor.businessId) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Rider does not belong to your business.' });
      }

      const payoutId = crypto.randomUUID();

      // 2. Lock funds immediately in a transaction to prevent double spending
      await db.transaction(async (tx) => {
        const walletList = await tx
          .select()
          .from(wallets)
          .where(and(eq(wallets.ownerId, riderId), eq(wallets.ownerType, 'RIDER')))
          .limit(1);

        if (walletList.length === 0) {
          throw new Error('WALLET_NOT_FOUND');
        }

        const wallet = walletList[0];

        if (wallet.balanceMinor < amountMinor) {
          throw new Error('INSUFFICIENT_FUNDS');
        }

        const balanceAfter = wallet.balanceMinor - amountMinor;

        // A. Deduct amount from rider wallet immediately
        await tx
          .update(wallets)
          .set({ balanceMinor: balanceAfter, updatedAt: new Date() })
          .where(eq(wallets.id, wallet.id));

        // B. Write debit ledger entry
        const ledgerId = crypto.randomUUID();
        await tx.insert(ledgerEntries).values({
          id: ledgerId,
          walletId: wallet.id,
          type: 'DEBIT',
          amountMinor,
          balanceAfterMinor: balanceAfter,
          referenceType: 'PAYOUT',
          referenceId: payoutId,
          description: 'Outward payout request initialization (funds locked).',
        });

        // C. Generate and hash OTP
        const rawOtp = generateOtp();
        const otpHash = hashOtp(rawOtp);
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

        const otpId = crypto.randomUUID();
        await tx.insert(otpVerifications).values({
          id: otpId,
          phoneNumber: rider.phoneNumber!,
          code: otpHash,
          purpose: 'PAYOUT_VERIFICATION',
          status: 'PENDING',
          expiresAt,
        });

        // D. Create SMS audit log
        const smsId = crypto.randomUUID();
        await tx.insert(smsLogs).values({
          id: smsId,
          phoneNumber: rider.phoneNumber!,
          message: `Your DispatchPay payout verification code is ${rawOtp}. Amount: GHS ${amountMinor / 100}.`,
          status: 'SENT',
        });

        // E. Create pending payout transaction record
        await tx.insert(payouts).values({
          id: payoutId,
          businessId: rider.businessId,
          riderId,
          amountMinor,
          currency: 'GHS',
          status: 'PENDING',
          recipientPhone: rider.momoNumber,
          recipientNetwork: rider.momoNetwork,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Log sandbox code for local developers
        fastify.log.info(`[SANDBOX PAYOUT OTP] Phone: ${rider.phoneNumber} | Code: ${rawOtp} | Payout ID: ${payoutId}`);
      });

      return reply.status(200).send({
        payoutId,
        status: 'PENDING',
        message: 'Payout initiated. Verification code sent to your registered phone number.',
      });

    } catch (err: any) {
      if (err.message === 'INSUFFICIENT_FUNDS') {
        return reply.status(400).send({ error: 'Bad Request', message: 'Insufficient wallet balance for payout.' });
      }
      if (err.message === 'WALLET_NOT_FOUND') {
        return reply.status(404).send({ error: 'Not Found', message: 'Rider wallet not found.' });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to initiate payout.' });
    }
  });

  // ── 2. VERIFY OUTWARD PAYOUT (DISBURSES FUNDS VIA MOOLRE) ───────────────
  fastify.post('/verify', async (request, reply) => {
    const bodyResult = payoutVerifySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Validation failed',
        details: bodyResult.error.flatten().fieldErrors,
      });
    }

    const { payoutId, otpCode } = bodyResult.data;
    const codeHash = hashOtp(otpCode);
    const actor = request.user;

    try {
      // 1. Fetch payout record
      const payoutList = await db
        .select()
        .from(payouts)
        .where(eq(payouts.id, payoutId))
        .limit(1);

      if (payoutList.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Payout request not found.' });
      }

      const payoutRecord = payoutList[0];

      // Security check
      if (actor.role === 'RIDER' && actor.id !== payoutRecord.riderId) {
        return reply.status(403).send({ error: 'Forbidden', message: 'You can only verify your own payouts.' });
      } else if (actor.role !== 'RIDER' && actor.businessId !== payoutRecord.businessId) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Payout request belongs to another tenant.' });
      }

      if (payoutRecord.status !== 'PENDING') {
        return reply.status(400).send({ error: 'Bad Request', message: `Payout request is already in '${payoutRecord.status}' state.` });
      }

      // Fetch Rider user phone to cross reference OTP target
      const userList = await db
        .select()
        .from(users)
        .where(eq(users.id, payoutRecord.riderId))
        .limit(1);

      if (userList.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Rider account not found.' });
      }

      const riderUser = userList[0];

      // 2. Validate OTP
      await db.transaction(async (tx) => {
        const otpRecordList = await tx
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

        if (otpRecordList.length === 0) {
          throw new Error('INVALID_OTP');
        }

        const otpRecord = otpRecordList[0];

        if (new Date() > otpRecord.expiresAt) {
          await tx
            .update(otpVerifications)
            .set({ status: 'EXPIRED' })
            .where(eq(otpVerifications.id, otpRecord.id));
          throw new Error('EXPIRED_OTP');
        }

        // Mark OTP as used
        await tx
          .update(otpVerifications)
          .set({ status: 'VERIFIED' })
          .where(eq(otpVerifications.id, otpRecord.id));

        // Mark payout status as PROCESSING
        await tx
          .update(payouts)
          .set({ status: 'PROCESSING', updatedAt: new Date() })
          .where(eq(payouts.id, payoutId));
      });

      // 3. Dispatch payment via Moolre API
      try {
        const disburseRes = await fastify.moolre.disbursePayout(
          {
            amountMinor: payoutRecord.amountMinor,
            recipientPhone: payoutRecord.recipientPhone,
            recipientNetwork: payoutRecord.recipientNetwork as any,
            referenceId: payoutRecord.id,
          },
          payoutRecord.id // payout ID acts as Idempotency Key!
        );

        // Update provider reference
        await db
          .update(payouts)
          .set({ 
            providerReference: disburseRes.providerReference, 
            status: disburseRes.status,
            updatedAt: new Date() 
          })
          .where(eq(payouts.id, payoutId));

        return reply.status(200).send({
          payoutId,
          status: disburseRes.status,
          providerReference: disburseRes.providerReference,
          message: disburseRes.status === 'SUCCESS' 
            ? 'Payout successfully disburse to your mobile wallet.' 
            : 'Payout is processing. We will update you via SMS when completed.',
        });

      } catch (disburseErr: any) {
        // If API call throws direct exception (e.g. invalid balance, connection hang, Moolre rejected)
        // Rollback: return locked funds back to rider wallet!
        await db.transaction(async (tx) => {
          const walletList = await tx
            .select()
            .from(wallets)
            .where(and(eq(wallets.ownerId, payoutRecord.riderId), eq(wallets.ownerType, 'RIDER')))
            .limit(1);

          if (walletList.length === 0) throw new Error('WALLET_NOT_FOUND_FATAL');

          const wallet = walletList[0];
          const balanceAfter = wallet.balanceMinor + payoutRecord.amountMinor;

          // Refund wallet
          await tx
            .update(wallets)
            .set({ balanceMinor: balanceAfter, updatedAt: new Date() })
            .where(eq(wallets.id, wallet.id));

          // Log refund transaction
          const ledgerId = crypto.randomUUID();
          await tx.insert(ledgerEntries).values({
            id: ledgerId,
            walletId: wallet.id,
            type: 'CREDIT',
            amountMinor: payoutRecord.amountMinor,
            balanceAfterMinor: balanceAfter,
            referenceType: 'WALLET_ADJUSTMENT',
            referenceId: payoutRecord.id,
            description: `Refund for failed payout authorization: ${disburseErr.message || 'Moolre error'}`,
          });

          // Mark payout as failed
          await tx
            .update(payouts)
            .set({ 
              status: 'FAILED', 
              errorMessage: disburseErr.message || 'API request error.', 
              updatedAt: new Date() 
            })
            .where(eq(payouts.id, payoutId));
        });

        return reply.status(502).send({
          error: 'Bad Gateway',
          message: `Payout disbursement failed: ${disburseErr.message || 'Error communicating with provider'}. Locked funds refunded.`,
        });
      }

    } catch (err: any) {
      if (err.message === 'INVALID_OTP') {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid verification code.' });
      }
      if (err.message === 'EXPIRED_OTP') {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Verification code has expired.' });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Verification failed.' });
    }
  });

};

export default payoutRoutes;
