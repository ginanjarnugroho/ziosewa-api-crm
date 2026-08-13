import { FastifyInstance } from 'fastify';
import { processIncomingWebhook } from '../services/zapierEngine';

export default async function webhookCatchController(fastify: FastifyInstance) {
  // ZioSewa Webhook Catch Endpoint for Booking & Sales module integration
  fastify.post('/api/v1/automation/webhooks/catch', async (request, reply) => {
    try {
      const payload = request.body as any;

      if (!payload || !payload.customer_phone) {
        return reply.status(400).send({
          success: false,
          error: 'Missing mandatory fields: customer_phone is required.'
        });
      }

      // Process event through our ZioSewa Automation Engine asynchronously
      const result = await processIncomingWebhook(payload);

      return reply.send({
        success: true,
        message: 'Webhook processed successfully by ZioSewa Automation Engine.',
        data: result
      });
    } catch (err: any) {
      console.error('[ZioSewa Webhook Error]', err);
      return reply.status(500).send({
        success: false,
        error: err.message || 'Failed to process automation webhook'
      });
    }
  });
}
