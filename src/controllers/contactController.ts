import { FastifyInstance } from 'fastify';
import { prisma } from '../repositories/prisma';
import { AdapterFactory } from '../services/AdapterFactory';

export default async function contactController(fastify: FastifyInstance) {
  fastify.get('/api/v1/contacts', {
    schema: {
      description: 'Get all contacts',
      tags: ['Contacts'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['device_id'],
        properties: {
          device_id: { type: 'string' },
          page: { type: 'integer' },
          limit: { type: 'integer' }
        }
      }
    }
  }, async (request, reply) => {
    const tenantId = (request as any).tenant.id;
    const { device_id } = request.query as any;
    const page = Number((request.query as any).page) || 1;
    const limit = Number((request.query as any).limit) || 50;

    try {
      const device = await prisma.device.findFirst({ where: { tenantId, deviceIdentifier: device_id } });
      if (!device) {
        reply.status(404);
        return { success: false, error: 'Device not found' };
      }

      const offset = (page - 1) * limit;

      const [contacts, total] = await Promise.all([
        prisma.contact.findMany({
          where: { tenantId, deviceId: device.id },
          orderBy: { pushName: 'asc' },
          skip: offset,
          take: limit
        }),
        prisma.contact.count({
          where: { tenantId, deviceId: device.id }
        })
      ]);

      const adapter = AdapterFactory.getAdapter(device.channelType) as any;
      const socket = adapter?.getSocket ? adapter.getSocket(device.id) : null;

      const processedContacts = await Promise.all(contacts.map(async (c: any) => {
        let name = c.pushName || c.verifiedName || null;
        if (!name && c.remoteJid.endsWith('@g.us') && socket) {
          try {
            const metadata = await socket.groupMetadata(c.remoteJid);
            if (metadata && metadata.subject) {
              name = metadata.subject;
              c.pushName = name;
              await prisma.contact.upsert({
                where: { deviceId_remoteJid: { deviceId: device.id, remoteJid: c.remoteJid } },
                create: { tenantId: device.tenantId, deviceId: device.id, remoteJid: c.remoteJid, pushName: name },
                update: { pushName: name }
              });
            }
          } catch (err) {
            console.error(`Failed to fetch group metadata for ${c.remoteJid}`, err);
          }
        }
        // Always use our backend proxy endpoint for profile_pic so we can generate fresh Signed URLs on the fly
        const originalProfilePic = c.profilePic;
        const baseUrl = `${request.protocol}://${request.headers.host}`;
        c.profilePic = `${baseUrl}/api/v1/contacts/${c.remoteJid}/avatar?tenant_id=${tenantId}&device_id=${device_id}`;
        if (originalProfilePic === 'none') {
          c.profilePic = null as any; // Explicitly no avatar
        }
        return c;
      }));

      return {
        success: true,
        data: processedContacts,
        meta: {
          page,
          limit,
          total
        }
      };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  fastify.put('/api/v1/contacts/:remoteJid', {
    schema: {
      description: 'Update a contact name',
      tags: ['Contacts'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['remoteJid'],
        properties: {
          remoteJid: { type: 'string' }
        }
      },
      body: {
        type: 'object',
        required: ['device_id', 'name'],
        properties: {
          device_id: { type: 'string' },
          name: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const tenantId = (request as any).tenant.id;
    const { remoteJid } = request.params as any;
    const { device_id, name } = request.body as any;

    try {
      const device = await prisma.device.findFirst({ where: { tenantId, deviceIdentifier: device_id } });
      if (!device) {
        reply.status(404);
        return { success: false, error: 'Device not found' };
      }

      const contact = await prisma.contact.update({
        where: { deviceId_remoteJid: { deviceId: device.id, remoteJid } },
        data: { pushName: name }
      });
      return { success: true, data: contact };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });
}
