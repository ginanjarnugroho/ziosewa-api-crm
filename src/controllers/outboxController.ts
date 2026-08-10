import { FastifyInstance } from 'fastify';
import prisma from '../repositories/prisma';
import { WahaAdapter } from '../adapters/WahaAdapter';

export default async function outboxController(fastify: FastifyInstance) {
  // GET Outbox Notifications
  fastify.get('/api/v1/outbox', async (request, reply) => {
    try {
      const { status, page = 1, limit = 20 } = request.query as any;
      const skip = (Number(page) - 1) * Number(limit);

      const whereClause: any = {};
      if (status && status !== 'ALL') {
        whereClause.status = status;
      }

      const [total, notifications] = await Promise.all([
        prisma.scheduledNotification.count({ where: whereClause }),
        prisma.scheduledNotification.findMany({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          skip,
          take: Number(limit)
        })
      ]);

      return {
        success: true,
        data: notifications,
        meta: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / Number(limit))
        }
      };
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // MANUAL RESEND Action
  fastify.post('/api/v1/outbox/:id/resend', async (request, reply) => {
    try {
      const { id } = request.params as any;

      const notif = await prisma.scheduledNotification.findUnique({
        where: { id }
      });

      if (!notif) {
        return reply.status(404).send({ success: false, error: 'Notification record not found' });
      }

      // Find active device
      const device = await prisma.device.findFirst({
        where: { status: 'connected' },
        orderBy: { updatedAt: 'desc' }
      });

      if (!device) {
        return reply.status(400).send({ success: false, error: 'No active connected device available to resend message' });
      }

      try {
        const wahaAdapter = new WahaAdapter();
        await wahaAdapter.sendMessage(device.deviceIdentifier, notif.recipient, notif.renderedText);

        const updated = await prisma.scheduledNotification.update({
          where: { id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            retryCount: notif.retryCount + 1,
            lastError: null
          }
        });

        return {
          success: true,
          message: 'Message resent successfully via WhatsApp',
          data: updated
        };
      } catch (err: any) {
        console.error(`[Manual Resend Error] Failed to resend notification ${id}:`, err);
        const updated = await prisma.scheduledNotification.update({
          where: { id },
          data: {
            status: 'FAILED',
            retryCount: notif.retryCount + 1,
            lastError: err.message
          }
        });

        return reply.status(500).send({
          success: false,
          error: `Failed to resend: ${err.message}`,
          data: updated
        });
      }
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}
