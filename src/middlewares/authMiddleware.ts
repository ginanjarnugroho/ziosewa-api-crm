import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../repositories/prisma';

export const authMiddleware = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!request.url.includes('/avatar')) {
    console.log(`[HTTP] ${request.method} ${request.url}`);
  }
  // Only apply to our protected API endpoints (except internal master endpoints, avatar proxy, WAHA webhooks, and automation catch webhooks)
  if (request.url.startsWith('/api/v1/') && !request.url.startsWith('/api/v1/internal/') && !request.url.includes('/avatar') && !request.url.startsWith('/api/v1/webhooks/waha') && !request.url.startsWith('/api/v1/automation/webhooks/catch')) {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ success: false, error: 'Missing or invalid Authorization Bearer token' });
    }

    const apiKey = authHeader.split(' ')[1];
    
    // Check database for this API key
    const tenant = await prisma.tenant.findFirst({
      where: { apiKey }
    });

    if (!tenant || tenant.status !== 'active') {
      return reply.status(403).send({ success: false, error: 'Invalid or inactive API Key' });
    }

    // IDOR Protection: Ensure that if the client sends tenant_id in query or body, it matches their API Key
    const query = request.query as any;
    const body = request.body as any;
    const requestedTenantId = query?.tenant_id || body?.tenant_id;

    if (requestedTenantId && requestedTenantId !== tenant.id) {
      return reply.status(403).send({ success: false, error: 'Access denied: You cannot access resources for another tenant_id' });
    }

    // Attach tenant to request for controllers to use if needed
    (request as any).tenant = tenant;
  }
}
