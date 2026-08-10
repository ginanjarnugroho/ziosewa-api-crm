import { FastifyInstance } from 'fastify';
import { prisma } from '../repositories/prisma';
import { compileTemplateText } from '../services/zapierEngine';

export default async function automationRuleController(fastify: FastifyInstance) {
  // GET all templates
  fastify.get('/api/v1/message-templates', async (request, reply) => {
    try {
      const templates = await prisma.messageTemplate.findMany({
        orderBy: { createdAt: 'desc' }
      });
      return { success: true, data: templates };
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // CREATE message template
  fastify.post('/api/v1/message-templates', async (request, reply) => {
    try {
      const { tenant_id, name, template_text } = request.body as any;
      const tenant = tenant_id ? { id: tenant_id } : await prisma.tenant.findFirst();
      if (!tenant) return reply.status(404).send({ success: false, error: 'Tenant not found' });

      const template = await prisma.messageTemplate.create({
        data: {
          tenantId: tenant.id,
          name: name || 'Template Baru',
          templateText: template_text || ''
        }
      });

      return { success: true, data: template };
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // UPDATE message template
  fastify.put('/api/v1/message-templates/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const { name, template_text } = request.body as any;

      const template = await prisma.messageTemplate.update({
        where: { id },
        data: {
          name: name !== undefined ? name : undefined,
          templateText: template_text !== undefined ? template_text : undefined
        }
      });

      return { success: true, data: template };
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // PREVIEW message template simulation
  fastify.post('/api/v1/message-templates/preview', async (request, reply) => {
    try {
      const { template_text, sample_data } = request.body as any;
      const defaultSample = {
        nama_pelanggan: 'Ginanjar Nugroho',
        nama_barang: 'Kamera Sony Alpha A7 III + Lensa 24-70mm',
        tgl_sewa: '10 Aug 2026',
        jam_kembali: '12 Aug 2026 18:00',
        total_bayar: 'Rp 450.000',
        sisa_tagihan: 'Rp 0',
        alamat_toko: 'SewaPro Store Lt. 1, Medan',
        ...sample_data
      };

      const previewText = compileTemplateText(template_text || '', defaultSample);
      return { success: true, preview_text: previewText };
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // GET all automation rules
  fastify.get('/api/v1/automation-rules', async (request, reply) => {
    try {
      const rules = await prisma.automationRule.findMany({
        include: { template: true },
        orderBy: { createdAt: 'desc' }
      });
      return { success: true, data: rules };
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // CREATE automation rule
  fastify.post('/api/v1/automation-rules', async (request, reply) => {
    try {
      const {
        tenant_id,
        name,
        trigger_type,
        target_status,
        offset_value,
        offset_unit,
        offset_direction,
        quiet_hours_start,
        quiet_hours_end,
        template_id,
        is_enabled
      } = request.body as any;

      const tenant = tenant_id ? { id: tenant_id } : await prisma.tenant.findFirst();
      if (!tenant) return reply.status(404).send({ success: false, error: 'Tenant not found' });

      const rule = await prisma.automationRule.create({
        data: {
          tenantId: tenant.id,
          name: name || 'Rule Baru',
          triggerType: trigger_type || 'EVENT_STATUS_CHANGED',
          targetStatus: target_status || 'ANY',
          offsetValue: Number(offset_value) || 0,
          offsetUnit: offset_unit || 'HOURS',
          offsetDirection: offset_direction || 'IMMEDIATE',
          quietHoursStart: quiet_hours_start || '20:00',
          quietHoursEnd: quiet_hours_end || '08:00',
          templateId: template_id,
          isEnabled: is_enabled !== undefined ? is_enabled : true
        },
        include: { template: true }
      });

      return { success: true, data: rule };
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // UPDATE automation rule
  fastify.put('/api/v1/automation-rules/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const {
        name,
        trigger_type,
        target_status,
        offset_value,
        offset_unit,
        offset_direction,
        quiet_hours_start,
        quiet_hours_end,
        template_id,
        is_enabled
      } = request.body as any;

      const rule = await prisma.automationRule.update({
        where: { id },
        data: {
          name: name !== undefined ? name : undefined,
          triggerType: trigger_type !== undefined ? trigger_type : undefined,
          targetStatus: target_status !== undefined ? target_status : undefined,
          offsetValue: offset_value !== undefined ? Number(offset_value) : undefined,
          offsetUnit: offset_unit !== undefined ? offset_unit : undefined,
          offsetDirection: offset_direction !== undefined ? offset_direction : undefined,
          quietHoursStart: quiet_hours_start !== undefined ? quiet_hours_start : undefined,
          quietHoursEnd: quiet_hours_end !== undefined ? quiet_hours_end : undefined,
          templateId: template_id !== undefined ? template_id : undefined,
          isEnabled: is_enabled !== undefined ? is_enabled : undefined
        },
        include: { template: true }
      });

      return { success: true, data: rule };
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // DELETE automation rule
  fastify.delete('/api/v1/automation-rules/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      await prisma.automationRule.delete({ where: { id } });
      return { success: true, message: 'Automation rule deleted successfully' };
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}
