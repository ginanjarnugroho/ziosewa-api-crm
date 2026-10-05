import { FastifyInstance } from 'fastify';
import { prisma } from '../repositories/prisma';
import { processBroadcastCampaign } from '../services/broadcastService';
import { CloudTasksService } from '../services/CloudTasksService';
import { normalizePhone } from '../services/zapierEngine';

export default async function broadcastController(fastify: FastifyInstance) {
  // List all campaigns
  fastify.get('/api/v1/broadcasts', async (request, reply) => {
    try {
      const tenantId = (request as any).tenant?.id;
      if (!tenantId) return reply.status(401).send({ success: false, error: 'Unauthorized' });
      const campaigns = await prisma.broadcastCampaign.findMany({
        where: { tenantId },
        include: { template: true },
        orderBy: { createdAt: 'desc' },
      });
      return { success: true, data: campaigns };
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // Get campaign details
  fastify.get('/api/v1/broadcasts/:id', async (request, reply) => {
    try {
      const tenantId = (request as any).tenant?.id;
      if (!tenantId) return reply.status(401).send({ success: false, error: 'Unauthorized' });
      const { id } = request.params as any;
      const campaign = await prisma.broadcastCampaign.findFirst({
        where: { id, tenantId },
        include: {
          template: true,
          targets: true
        }
      });
      if (!campaign) {
        return reply.status(404).send({ success: false, error: 'Campaign not found' });
      }
      return { success: true, data: campaign };
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // Create & Start a campaign
  fastify.post('/api/v1/broadcasts', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'templateId', 'targetType', 'targets'],
        properties: {
          name: { type: 'string' },
          templateId: { type: 'string' },
          targetType: { type: 'string', enum: ['CUSTOMER', 'AGENT', 'CUSTOM'] },
          deviceId: { type: 'string', nullable: true },
          scheduleAt: { type: 'string', nullable: true },
          scheduledAt: { type: 'string', nullable: true },
          targets: {
            type: 'array',
            items: {
              type: 'object',
              required: ['phone'],
              properties: {
                phone: { type: 'string' },
                variables: { type: 'object' } // e.g. { nama: 'Budi' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const tenantId = (request as any).tenant?.id || (request.body as any)?.tenant_id;
      if (!tenantId) return reply.status(401).send({ success: false, error: 'Unauthorized' });
      const { name, templateId, targetType, deviceId, targets, scheduleAt, scheduledAt } = request.body as any;

      if (!targets || targets.length === 0) {
        return reply.status(400).send({ success: false, error: 'Targets cannot be empty' });
      }

      // Verify template belongs to tenant
      const template = await prisma.messageTemplate.findFirst({
        where: { id: templateId, tenantId }
      });
      if (!template) {
        return reply.status(404).send({ success: false, error: 'Template not found for this tenant' });
      }

      // Parse optional scheduleAt / scheduledAt
      const rawSchedule = scheduleAt || scheduledAt;
      let scheduledDate: Date | null = null;
      if (rawSchedule) {
        const parsed = new Date(rawSchedule);
        if (!isNaN(parsed.getTime())) {
          scheduledDate = parsed;
        }
      }

      const isScheduledInFuture = !!(scheduledDate && scheduledDate.getTime() > Date.now());

      // 1. Create the Campaign
      const campaign = await prisma.broadcastCampaign.create({
        data: {
          tenantId,
          name,
          templateId,
          targetType,
          deviceId: deviceId || null,
          totalTargets: targets.length,
          status: isScheduledInFuture ? 'SCHEDULED' : 'DRAFT',
          scheduledAt: scheduledDate
        }
      });

      // 2. Create the Targets in DB (overriding target.phone using normalizePhone)
      const targetData = targets.map((t: any) => ({
        campaignId: campaign.id,
        phone: normalizePhone(t.phone),
        variables: t.variables || {},
        status: 'PENDING' as const
      }));

      await prisma.broadcastTarget.createMany({
        data: targetData
      });

      // 3. Process or Schedule via Cloud Tasks
      if (isScheduledInFuture && scheduledDate) {
        try {
          await CloudTasksService.enqueueTask(
            '/api/v1/internal/tasks/process-broadcast',
            { campaignId: campaign.id },
            scheduledDate
          );
          console.log(`[Broadcast] Enqueued campaign ${campaign.id} to Cloud Tasks for ${scheduledDate.toISOString()}`);
        } catch (ctErr: any) {
          console.warn('[Broadcast] Cloud Tasks scheduling skipped/fallback to background trigger:', ctErr.message);
        }
      } else {
        // Trigger processing immediately in background
        processBroadcastCampaign(campaign.id).catch(err => {
          console.error('Background processBroadcastCampaign error:', err);
        });
      }

      return { 
        success: true, 
        message: isScheduledInFuture
          ? `Campaign created and scheduled for ${scheduledDate!.toISOString()}`
          : 'Campaign created and queued for processing',
        data: campaign 
      };
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });
}
