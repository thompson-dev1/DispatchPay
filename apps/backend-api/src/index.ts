import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import * as dotenv from 'dotenv';
import { db } from '@dispatchpay/db';
import authPlugin from './plugins/authenticate';
import authRoutes from './routes/auth';

declare module 'fastify' {
  export interface FastifyInstance {
    authenticate(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply): Promise<void>;
    requireRole(allowedRoles: string[]): (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
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

    // Register Auth Routes
    await fastify.register(authRoutes, { prefix: '/api/v1/auth' });

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
