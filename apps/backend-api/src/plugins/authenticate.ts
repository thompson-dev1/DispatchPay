import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      id: string;
      email?: string;
      phoneNumber?: string;
      role: 'SUPER_ADMIN' | 'BUSINESS_OWNER' | 'BUSINESS_MANAGER' | 'RIDER';
      businessId: string | null;
    };
    user: {
      id: string;
      email?: string;
      phoneNumber?: string;
      role: 'SUPER_ADMIN' | 'BUSINESS_OWNER' | 'BUSINESS_MANAGER' | 'RIDER';
      businessId: string | null;
    };
  }
}

const authPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Decorate the fastify instance with authenticate method
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or missing authentication token' });
    }
  });

  // PreValidation Hook Generator to enforce Role-based Access Control (RBAC)
  fastify.decorate('requireRole', (allowedRoles: string[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      // Must run after request.jwtVerify()
      const user = request.user;
      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required' });
      }

      if (!allowedRoles.includes(user.role)) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to access this resource',
        });
      }
    };
  });
};

export default fp(authPlugin);
