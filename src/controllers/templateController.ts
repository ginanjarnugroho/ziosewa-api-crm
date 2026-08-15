import { FastifyInstance } from 'fastify';
import { prisma } from '../repositories/prisma';
export default async function templateController(fastify: FastifyInstance) {
  // List all templates
  fastify.get('/api/v1/templates', async (request, reply) => {
    try {
      const tenantId = (request as any).tenant?.id;
      if (!tenantId) return reply.status(401).send({ success: false, error: 'Unauthorized' });
      const templates = await prisma.messageTemplate.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
      return { success: true, data: templates };
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // Get single template
  fastify.get('/api/v1/templates/:id', async (request, reply) => {
    try {
      const tenantId = (request as any).tenant?.id;
      if (!tenantId) return reply.status(401).send({ success: false, error: 'Unauthorized' });
      const { id } = request.params as any;
      const template = await prisma.messageTemplate.findFirst({
        where: { id, tenantId },
      });
      if (!template) {
        return reply.status(404).send({ success: false, error: 'Template not found' });
      }
      return { success: true, data: template };
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // Create a new template
  fastify.post('/api/v1/templates', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'templateText'],
        properties: {
          name: { type: 'string' },
          templateText: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const tenantId = (request as any).tenant?.id;
      if (!tenantId) return reply.status(401).send({ success: false, error: 'Unauthorized' });
      const { name, templateText } = request.body as any;

      const template = await prisma.messageTemplate.create({
        data: {
          tenantId,
          name,
          templateText
        }
      });
      return { success: true, data: template };
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // Update a template
  fastify.put('/api/v1/templates/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          templateText: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const tenantId = (request as any).tenant?.id;
      if (!tenantId) return reply.status(401).send({ success: false, error: 'Unauthorized' });
      const { id } = request.params as any;
      const { name, templateText } = request.body as any;

      const existing = await prisma.messageTemplate.findFirst({
        where: { id, tenantId }
      });
      if (!existing) {
        return reply.status(404).send({ success: false, error: 'Template not found' });
      }

      const updated = await prisma.messageTemplate.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(templateText && { templateText })
        }
      });
      return { success: true, data: updated };
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // Delete a template
  fastify.delete('/api/v1/templates/:id', async (request, reply) => {
    try {
      const tenantId = (request as any).tenant?.id;
      if (!tenantId) return reply.status(401).send({ success: false, error: 'Unauthorized' });
      const { id } = request.params as any;
      
      const existing = await prisma.messageTemplate.findFirst({
        where: { id, tenantId }
      });
      if (!existing) {
        return reply.status(404).send({ success: false, error: 'Template not found' });
      }

      await prisma.messageTemplate.delete({
        where: { id }
      });

      return { success: true, message: 'Template deleted' };
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });
}
