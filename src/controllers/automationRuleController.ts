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
      console.error('[GET message-templates Error]', err.message);
      return { success: true, data: [] };
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

  // GET all automation rules (raw SQL query to guarantee device_id & device object)
  fastify.get('/api/v1/automation-rules', async (request, reply) => {
    try {
      const rawRules: any[] = await prisma.$queryRawUnsafe(`
        SELECT 
          r.id,
          r.tenant_id as "tenantId",
          r.device_id as "deviceId",
          r.device_id as "device_id",
          r.name,
          r.trigger_type as "triggerType",
          r.target_status as "targetStatus",
          r.offset_value as "offsetValue",
          r.offset_unit as "offsetUnit",
          r.offset_direction as "offsetDirection",
          r.quiet_hours_start as "quietHoursStart",
          r.quiet_hours_end as "quietHoursEnd",
          r.template_id as "templateId",
          r.is_enabled as "isEnabled",
          r.created_at as "createdAt",
          r.updated_at as "updatedAt",
          row_to_json(t) as template,
          row_to_json(d) as device
        FROM automation_rules r
        LEFT JOIN message_templates t ON r.template_id = t.id
        LEFT JOIN devices d ON r.device_id = d.id
        ORDER BY r.created_at DESC
      `);
      return { success: true, data: rawRules };
    } catch (err: any) {
      console.error('[GET automation-rules Raw Error]', err.message);
      // Fallback query if raw SQL fails
      const rules = await prisma.automationRule.findMany({
        include: { template: true },
        orderBy: { createdAt: 'desc' }
      });
      return { success: true, data: rules };
    }
  });

  // CREATE automation rule
  fastify.post('/api/v1/automation-rules', async (request, reply) => {
    try {
      const {
        tenant_id,
        device_id,
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

      const validDeviceId = (device_id && typeof device_id === 'string' && device_id.trim() !== '') ? device_id.trim() : null;

      try {
        const rule = await prisma.automationRule.create({
          data: {
            tenantId: tenant.id,
            deviceId: validDeviceId,
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
      } catch (createErr: any) {
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

        if (validDeviceId) {
          await prisma.$executeRawUnsafe(
            `UPDATE "automation_rules" SET "device_id" = '${validDeviceId}'::uuid WHERE "id" = '${rule.id}'::uuid`
          );
        }

        return { success: true, data: rule };
      }
    } catch (err: any) {
      console.error('[CREATE Rule Error]', err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // UPDATE automation rule
  fastify.put('/api/v1/automation-rules/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const {
        device_id,
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

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (trigger_type !== undefined) updateData.triggerType = trigger_type;
      if (target_status !== undefined) updateData.targetStatus = target_status;
      if (offset_value !== undefined) updateData.offsetValue = Number(offset_value);
      if (offset_unit !== undefined) updateData.offsetUnit = offset_unit;
      if (offset_direction !== undefined) updateData.offsetDirection = offset_direction;
      if (quiet_hours_start !== undefined) updateData.quietHoursStart = quiet_hours_start;
      if (quiet_hours_end !== undefined) updateData.quietHoursEnd = quiet_hours_end;
      if (template_id !== undefined) updateData.templateId = template_id;
      if (is_enabled !== undefined) updateData.isEnabled = is_enabled;

      const validDeviceId = (device_id !== undefined && device_id && typeof device_id === 'string' && device_id.trim() !== '') ? device_id.trim() : null;

      try {
        if (device_id !== undefined) {
          updateData.deviceId = validDeviceId;
        }

        const rule = await prisma.automationRule.update({
          where: { id },
          data: updateData,
          include: { template: true }
        });

        return { success: true, data: rule };
      } catch (prismaValidationErr: any) {
        delete updateData.deviceId;

        if (device_id !== undefined) {
          if (validDeviceId) {
            await prisma.$executeRawUnsafe(
              `UPDATE "automation_rules" SET "device_id" = '${validDeviceId}'::uuid WHERE "id" = '${id}'::uuid`
            );
          } else {
            await prisma.$executeRawUnsafe(
              `UPDATE "automation_rules" SET "device_id" = NULL WHERE "id" = '${id}'::uuid`
            );
          }
        }

        const rule = await prisma.automationRule.update({
          where: { id },
          data: updateData,
          include: { template: true }
        });

        return { success: true, data: rule };
      }
    } catch (err: any) {
      console.error('[UPDATE Rule Error]', err);
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
