import { FastifyInstance } from 'fastify';
import { prisma } from '../repositories/prisma';
import { masterAuthMiddleware } from '../middlewares/masterAuthMiddleware';

export default async function tenantController(fastify: FastifyInstance) {
  fastify.put('/api/v1/tenants/webhook', {
    schema: {
      description: 'Update tenant webhook URL',
      tags: ['Tenants'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['webhook_url'],
        properties: {
          webhook_url: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const tenantId = (request as any).tenant.id;
    const { webhook_url } = request.body as any;

    try {
      const tenant = await prisma.tenant.update({
        where: { id: tenantId },
        data: { webhookUrl: webhook_url }
      });
      return { success: true, webhook_url: tenant.webhookUrl };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  fastify.post('/api/v1/internal/tenants', {
    preHandler: masterAuthMiddleware,
    schema: {
      description: 'Create a new tenant (Internal Master Key Use Only)',
      tags: ['Internal'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          id: { type: 'string', description: 'Match with your internal ID' },
          name: { type: 'string' },
          api_key: { type: 'string', description: 'Optional. Leave blank to auto-generate' }
        }
      }
    }
  }, async (request, reply) => {
    const { id, name, api_key } = request.body as any;
    
    try {
      const data: any = { name };
      if (id) data.id = id;
      if (api_key) data.apiKey = api_key;
      
      const tenant = await prisma.tenant.create({ data });
      return reply.status(201).send({ success: true, data: tenant });
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });
}
