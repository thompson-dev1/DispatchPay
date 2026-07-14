import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and } from '@dispatchpay/db';
import { 
  businesses, 
  users, 
  riders, 
  wallets, 
  otpVerifications, 
  smsLogs 
} from '@dispatchpay/db';
import { db } from '@dispatchpay/db';
import { 
  businessRegisterSchema, 
  businessLoginSchema, 
  riderRegisterSchema,
  riderLoginOtpRequestSchema,
  riderLoginOtpVerifySchema
} from '@dispatchpay/types';
import { hashPassword, verifyPassword, generateOtp, hashOtp } from '../utils/crypto';
import crypto from 'crypto';

const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // ── 1. REGISTER BUSINESS ──────────────────────────────────────────────────
  fastify.post('/business/register', async (request, reply) => {
    // Validate request body
    const bodyResult = businessRegisterSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Validation failed',
        details: bodyResult.error.flatten().fieldErrors,
      });
    }

    const { businessName, businessEmail, adminEmail, adminPassword } = bodyResult.data;

    try {
      // Execute atomically in a transaction
      const result = await db.transaction(async (tx) => {
        // 1. Check if email already exists
        const existingUser = await tx
          .select()
          .from(users)
          .where(eq(users.email, adminEmail))
          .limit(1);

        if (existingUser.length > 0) {
          throw new Error('EMAIL_EXISTS');
        }

        const existingBusiness = await tx
          .select()
          .from(businesses)
          .where(eq(businesses.email, businessEmail))
          .limit(1);

        if (existingBusiness.length > 0) {
          throw new Error('BUSINESS_EMAIL_EXISTS');
        }

        // 2. Insert Business
        const businessId = crypto.randomUUID();
        await tx.insert(businesses).values({
          id: businessId,
          name: businessName,
          email: businessEmail,
        });

        // 3. Hash Password & Insert Admin User
        const userId = crypto.randomUUID();
        const passwordHash = await hashPassword(adminPassword);
        await tx.insert(users).values({
          id: userId,
          email: adminEmail,
          passwordHash,
          role: 'BUSINESS_OWNER',
          businessId,
          isActive: true,
        });

        // 4. Create Business Wallet
        const walletId = crypto.randomUUID();
        await tx.insert(wallets).values({
          id: walletId,
          ownerId: businessId,
          ownerType: 'BUSINESS',
          balanceMinor: 0,
          currency: 'GHS',
        });

        return { businessId, userId };
      });

      return reply.status(201).send({
        businessId: result.businessId,
        userId: result.userId,
        message: 'Business registered successfully.',
      });
    } catch (err: any) {
      if (err.message === 'EMAIL_EXISTS' || err.message === 'BUSINESS_EMAIL_EXISTS') {
        return reply.status(409).send({
          error: 'Conflict',
          message: err.message === 'EMAIL_EXISTS' 
            ? 'Admin email is already registered.' 
            : 'Business email is already registered.',
        });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to register business.' });
    }
  });

  // ── 2. LOGIN BUSINESS USER ────────────────────────────────────────────────
  fastify.post('/business/login', async (request, reply) => {
    const bodyResult = businessLoginSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Validation failed',
        details: bodyResult.error.flatten().fieldErrors,
      });
    }

    const { email, password } = bodyResult.data;

    try {
      const userList = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (userList.length === 0) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid email or password.' });
      }

      const user = userList[0];

      if (!user.isActive) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Your account is deactivated.' });
      }

      if (!user.passwordHash) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid credentials.' });
      }

      const isPasswordValid = await verifyPassword(user.passwordHash, password);
      if (!isPasswordValid) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid email or password.' });
      }

      // Generate Access Token (expires in 15 mins)
      const accessToken = fastify.jwt.sign(
        {
          id: user.id,
          email: user.email || undefined,
          role: user.role as any,
          businessId: user.businessId,
        },
        { expiresIn: '15m' }
      );

      // Generate Refresh Token (expires in 7 days)
      const refreshToken = fastify.jwt.sign(
        { id: user.id, role: user.role as any, businessId: user.businessId },
        { expiresIn: '7d' }
      );

      // Set HttpOnly Refresh Token Cookie
      reply.setCookie('refreshToken', refreshToken, {
        path: '/api/v1/auth/refresh',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      });

      return reply.status(200).send({
        accessToken,
        expiresIn: 900, // 15 mins in seconds
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          businessId: user.businessId,
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Login failed.' });
    }
  });

  // ── 3. REGISTER RIDER PROFILE (ADMIN ONLY) ───────────────────────────────
  fastify.post(
    '/rider/register',
    {
      preValidation: [
        fastify.authenticate,
        fastify.requireRole(['BUSINESS_OWNER', 'BUSINESS_MANAGER']),
      ],
    },
    async (request, reply) => {
      const bodyResult = riderRegisterSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Validation failed',
          details: bodyResult.error.flatten().fieldErrors,
        });
      }

      const { firstName, lastName, phoneNumber, vehicleType, vehiclePlate, momoNetwork, momoNumber } = bodyResult.data;
      const admin = request.user;

      if (!admin.businessId) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Admin must be linked to a business.' });
      }

      try {
        const result = await db.transaction(async (tx) => {
          // Check if phone number exists in users
          const existingUser = await tx
            .select()
            .from(users)
            .where(eq(users.phoneNumber, phoneNumber))
            .limit(1);

          if (existingUser.length > 0) {
            throw new Error('PHONE_EXISTS');
          }

          // 1. Create Rider User Account
          const riderUserId = crypto.randomUUID();
          await tx.insert(users).values({
            id: riderUserId,
            phoneNumber: phoneNumber,
            role: 'RIDER',
            businessId: admin.businessId!,
            isActive: true,
          });

          // 2. Create Rider Profile
          await tx.insert(riders).values({
            id: riderUserId,
            businessId: admin.businessId!,
            firstName,
            lastName,
            vehicleType,
            vehiclePlate,
            momoNetwork,
            momoNumber,
          });

          // 3. Create Rider Wallet
          const walletId = crypto.randomUUID();
          await tx.insert(wallets).values({
            id: walletId,
            ownerId: riderUserId,
            ownerType: 'RIDER',
            balanceMinor: 0,
            currency: 'GHS',
          });

          return { riderUserId };
        });

        return reply.status(201).send({
          riderId: result.riderUserId,
          businessId: admin.businessId,
          message: 'Rider account provisioned successfully.',
        });
      } catch (err: any) {
        if (err.message === 'PHONE_EXISTS') {
          return reply.status(409).send({
            error: 'Conflict',
            message: 'Phone number already registered.',
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to register rider.' });
      }
    }
  );

  // ── 4. REQUEST RIDER LOGIN OTP ────────────────────────────────────────────
  fastify.post('/rider/login-otp', async (request, reply) => {
    const bodyResult = riderLoginOtpRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Validation failed',
        details: bodyResult.error.flatten().fieldErrors,
      });
    }

    const { phoneNumber } = bodyResult.data;

    try {
      // 1. Ensure rider is registered
      const riderList = await db
        .select()
        .from(users)
        .where(and(eq(users.phoneNumber, phoneNumber), eq(users.role, 'RIDER')))
        .limit(1);

      if (riderList.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Rider phone number not registered.' });
      }

      const rider = riderList[0];
      if (!rider.isActive) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Rider account is deactivated.' });
      }

      // 2. Generate cryptographically secure OTP code
      const rawOtp = generateOtp();
      const otpHash = hashOtp(rawOtp);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes TTL

      // 3. Write OTP to DB & log SMS delivery
      const otpId = crypto.randomUUID();
      const smsLogId = crypto.randomUUID();

      await db.transaction(async (tx) => {
        // Insert OTP record
        await tx.insert(otpVerifications).values({
          id: otpId,
          phoneNumber,
          code: otpHash,
          purpose: 'LOGIN',
          status: 'PENDING',
          expiresAt,
        });

        // Insert SMS delivery log
        await tx.insert(smsLogs).values({
          id: smsLogId,
          phoneNumber,
          message: `Your DispatchPay verification code is ${rawOtp}. Valid for 5 minutes.`,
          status: 'SENT', // Simulated sent status
        });
      });

      // Sandbox log output so developers can inspect sandbox OTP values without SMS gateway integration
      fastify.log.info(`[SANDBOX OTP] Phone: ${phoneNumber} | Code: ${rawOtp} | Verification ID: ${otpId}`);

      return reply.status(200).send({
        otpId,
        message: 'OTP sent successfully.',
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to request OTP.' });
    }
  });

  // ── 5. VERIFY RIDER LOGIN OTP ─────────────────────────────────────────────
  fastify.post('/rider/verify-otp', async (request, reply) => {
    const bodyResult = riderLoginOtpVerifySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Validation failed',
        details: bodyResult.error.flatten().fieldErrors,
      });
    }

    const { phoneNumber, otpCode } = bodyResult.data;
    const codeHash = hashOtp(otpCode);

    try {
      const result = await db.transaction(async (tx) => {
        // Find matching pending OTP
        const otpRecordList = await tx
          .select()
          .from(otpVerifications)
          .where(
            and(
              eq(otpVerifications.phoneNumber, phoneNumber),
              eq(otpVerifications.code, codeHash),
              eq(otpVerifications.purpose, 'LOGIN'),
              eq(otpVerifications.status, 'PENDING')
            )
          )
          .limit(1);

        if (otpRecordList.length === 0) {
          throw new Error('INVALID_OTP');
        }

        const otpRecord = otpRecordList[0];

        // Check expiration
        if (new Date() > otpRecord.expiresAt) {
          await tx
            .update(otpVerifications)
            .set({ status: 'EXPIRED' })
            .where(eq(otpVerifications.id, otpRecord.id));
          throw new Error('EXPIRED_OTP');
        }

        // Mark OTP as verified
        await tx
          .update(otpVerifications)
          .set({ status: 'VERIFIED' })
          .where(eq(otpVerifications.id, otpRecord.id));

        // Fetch rider user
        const riderList = await tx
          .select()
          .from(users)
          .where(and(eq(users.phoneNumber, phoneNumber), eq(users.role, 'RIDER')))
          .limit(1);

        return riderList[0];
      });

      // Generate Access Token (expires in 15 mins)
      const accessToken = fastify.jwt.sign(
        {
          id: result.id,
          phoneNumber: result.phoneNumber || undefined,
          role: result.role as any,
          businessId: result.businessId,
        },
        { expiresIn: '15m' }
      );

      // Generate Refresh Token (expires in 7 days)
      const refreshToken = fastify.jwt.sign(
        { id: result.id, role: result.role as any, businessId: result.businessId },
        { expiresIn: '7d' }
      );

      // Set HttpOnly Refresh Token Cookie
      reply.setCookie('refreshToken', refreshToken, {
        path: '/api/v1/auth/refresh',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      });

      return reply.status(200).send({
        accessToken,
        expiresIn: 900,
        user: {
          id: result.id,
          phoneNumber: result.phoneNumber,
          role: result.role,
          businessId: result.businessId,
        },
      });
    } catch (err: any) {
      if (err.message === 'INVALID_OTP') {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid verification code.' });
      }
      if (err.message === 'EXPIRED_OTP') {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Verification code has expired.' });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to verify OTP.' });
    }
  });

  // ── 6. REFRESH TOKEN (TOKEN ROTATION) ─────────────────────────────────────
  fastify.post('/refresh', async (request, reply) => {
    const refreshTokenCookie = request.cookies.refreshToken;
    if (!refreshTokenCookie) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Missing refresh token.' });
    }

    try {
      const decoded = fastify.jwt.verify<any>(refreshTokenCookie);
      
      const userList = await db
        .select()
        .from(users)
        .where(eq(users.id, decoded.id))
        .limit(1);

      if (userList.length === 0) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'User not found.' });
      }

      const user = userList[0];
      if (!user.isActive) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Account is deactivated.' });
      }

      // Rotate Access Token
      const accessToken = fastify.jwt.sign(
        {
          id: user.id,
          email: user.email || undefined,
          phoneNumber: user.phoneNumber || undefined,
          role: user.role as any,
          businessId: user.businessId,
        },
        { expiresIn: '15m' }
      );

      // Rotate Refresh Token
      const nextRefreshToken = fastify.jwt.sign(
        { id: user.id, role: user.role as any, businessId: user.businessId },
        { expiresIn: '7d' }
      );

      reply.setCookie('refreshToken', nextRefreshToken, {
        path: '/api/v1/auth/refresh',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60,
      });

      return reply.status(200).send({
        accessToken,
        expiresIn: 900,
        user: {
          id: user.id,
          email: user.email || undefined,
          phoneNumber: user.phoneNumber || undefined,
          role: user.role,
          businessId: user.businessId,
        },
      });
    } catch {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired refresh token.' });
    }
  });

  // ── 7. LOGOUT ─────────────────────────────────────────────────────────────
  fastify.post('/logout', async (_request, reply) => {
    reply.clearCookie('refreshToken', {
      path: '/api/v1/auth/refresh',
    });
    return reply.status(200).send({ message: 'Logged out successfully.' });
  });

};

export default authRoutes;
