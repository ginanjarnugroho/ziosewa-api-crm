import { FastifyInstance } from 'fastify';
import { processIncomingWebhook, WebhookPayload } from '../services/zapierEngine';

export default async function webhookCatchController(fastify: FastifyInstance) {
  // ZioSewa Webhook Catch Endpoint for Booking & Sales module integration
  fastify.post('/api/v1/automation/webhooks/catch', async (request, reply) => {
    try {
      const body = request.body as any;

      if (!body) {
        return reply.status(400).send({
          success: false,
          error: 'Empty request body.'
        });
      }

      // Check if body is an array or single payload object
      const isList = Array.isArray(body);
      const items: WebhookPayload[] = isList ? body : [body];

      // Filter valid payloads containing customer_phone
      const validItems = items.filter(item => item && typeof item === 'object' && !!item.customer_phone);

      if (validItems.length === 0) {
        return reply.status(400).send({
          success: false,
          error: 'Missing mandatory fields: customer_phone is required for each webhook payload.'
        });
      }

      const results: any[] = [];
      for (const item of validItems) {
        try {
          const res = await processIncomingWebhook(item);
          results.push({
            order_id: item.order_id || null,
            module_id: item.module_id || item.moduleId || null,
            customer_phone: item.customer_phone,
            event_type: item.event_type || item.status || null,
            result: res
          });
        } catch (itemErr: any) {
          console.error(`[ZioSewa Webhook Batch Item Error] customer_phone=${item.customer_phone}:`, itemErr.message);
          results.push({
            order_id: item.order_id || null,
            module_id: item.module_id || item.moduleId || null,
            customer_phone: item.customer_phone,
            error: itemErr.message
          });
        }
      }

      if (isList) {
        return reply.send({
          success: true,
          message: `Processed ${results.length} webhook payload(s) by ZioSewa Automation Engine.`,
          processedCount: results.length,
          data: results
        });
      }

      return reply.send({
        success: true,
        message: 'Webhook processed successfully by ZioSewa Automation Engine.',
        data: results[0]?.result || results[0]
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
