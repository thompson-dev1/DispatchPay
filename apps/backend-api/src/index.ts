import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import * as dotenv from 'dotenv';
import { db } from '@dispatchpay/db';
import authPlugin from './plugins/authenticate';
import authRoutes from './routes/auth';
import deliveryRoutes from './routes/deliveries';
import businessRoutes from './routes/businesses';
import riderRoutes from './routes/riders';
import paymentRoutes from './routes/payments';
import payoutRoutes from './routes/payouts';
import { MoolreService } from './services/moolre.service';

declare module 'fastify' {
  export interface FastifyInstance {
    authenticate(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply): Promise<void>;
    requireRole(allowedRoles: string[]): (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
    moolre: MoolreService;
  }
}

dotenv.config();

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    redact: {
      paths: ['req.headers.authorization', 'body.password', 'body.otpCode', 'body.momoNumber'],
      censor: '[REDACTED]',
    },
  },
});

const start = async () => {
  try {
    // Register CORS
    await fastify.register(cors, {
      origin: process.env.CORS_ALLOWED_ORIGINS?.split(',') || true,
      credentials: true,
    });

    // Register Cookie Parser
    await fastify.register(cookie, {
      secret: process.env.COOKIE_SECRET || 'dispatchpay-cookie-secret-very-long',
    });

    // Register JWT
    await fastify.register(jwt, {
      secret: process.env.JWT_SECRET || 'dispatchpay-jwt-secret-very-long',
    });

    // Register Custom Auth Plugin
    await fastify.register(authPlugin);

    // Instantiate and Decorate Moolre Service
    const moolreServiceInstance = new MoolreService({
      apiKey: process.env.MOOLRE_API_KEY || 'moolre-sandbox-api-key',
      baseUrl: process.env.MOOLRE_BASE_URL || 'https://sandbox.moolre.com/api',
      webhookSecret: process.env.MOOLRE_WEBHOOK_SECRET || 'moolre-webhook-secret-key',
    });
    fastify.decorate('moolre', moolreServiceInstance);

    // Register Auth Routes
    await fastify.register(authRoutes, { prefix: '/api/v1/auth' });

    // Register Delivery Routes
    await fastify.register(deliveryRoutes, { prefix: '/api/v1/deliveries' });

    // Register Business Routes
    await fastify.register(businessRoutes, { prefix: '/api/v1/businesses' });

    // Register Rider Routes
    await fastify.register(riderRoutes, { prefix: '/api/v1/riders' });

    // Register Payment Routes
    await fastify.register(paymentRoutes, { prefix: '/api/v1/payments' });

    // Register Payout Routes
    await fastify.register(payoutRoutes, { prefix: '/api/v1/payouts' });

    // Health check route
    fastify.get('/health', async (_request, reply) => {
      try {
        // Test database connection
        await db.run(sql`SELECT 1`);
        return {
          status: 'healthy',
          checks: {
            database: { status: 'up' },
          },
        };
      } catch (err: any) {
        reply.status(503);
        return {
          status: 'unhealthy',
          checks: {
            database: { status: 'down', error: err.message },
          },
        };
      }
    });

    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Server listening on http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Import sql tag safely
import { sql } from '@dispatchpay/db';

start();
