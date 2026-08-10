import { prisma } from '../repositories/prisma';
import { WahaAdapter } from '../adapters/WahaAdapter';

export interface WebhookPayload {
  tenant_id?: string;
  event_type?: string; // e.g. ORDER_STATUS_CHANGED, ORDER_CREATED
  status?: string; // e.g. ORDER_CREATED, PREPARING, READY_FOR_PICKUP, RETURNED
  order_id?: string;
  customer_phone: string;
  due_datetime?: string; // ISO string
  data?: {
    nama_pelanggan?: string;
    nama_barang?: string;
    tgl_sewa?: string;
    jam_kembali?: string;
    total_bayar?: string;
    sisa_tagihan?: string;
    alamat_toko?: string;
    [key: string]: any;
  };
}

export function compileTemplateText(templateText: string, data: Record<string, any> = {}): string {
  if (!templateText) return '';
  
  let result = templateText;
  const replacements: Record<string, string> = {
    '{nama_pelanggan}': data.nama_pelanggan || 'Pelanggan',
    '{nama_barang}': data.nama_barang || 'Barang Sewa',
    '{tgl_sewa}': data.tgl_sewa || '-',
    '{jam_kembali}': data.jam_kembali || '-',
    '{total_bayar}': data.total_bayar || '-',
    '{sisa_tagihan}': data.sisa_tagihan || '-',
    '{alamat_toko}': data.alamat_toko || '-'
  };

  for (const [tag, val] of Object.entries(replacements)) {
    result = result.split(tag).join(val);
  }

  // Also support custom {key} matching from data object
  for (const [key, val] of Object.entries(data)) {
    if (typeof val === 'string' || typeof val === 'number') {
      result = result.split(`{${key}}`).join(String(val));
    }
  }

  return result;
}

export function enforceQuietHours(scheduledDate: Date, startStr: string = '20:00', endStr: string = '08:00'): Date {
  const target = new Date(scheduledDate);
  const hour = target.getHours();

  const [startHour] = startStr.split(':').map(Number);
  const [endHour] = endStr.split(':').map(Number);

  // If startHour is e.g. 20 (8 PM) and endHour is 8 (8 AM)
  const isNight = hour >= startHour || hour < endHour;

  if (isNight) {
    // Adjust target date to next morning 08:00 AM
    if (hour >= startHour) {
      target.setDate(target.getDate() + 1);
    }
    target.setHours(endHour, 0, 0, 0);
  }

  return target;
}

export async function processIncomingWebhook(payload: WebhookPayload) {
  // Normalize phone number to @c.us format
  const rawDigits = payload.customer_phone.replace(/\D/g, '');
  const recipientJid = rawDigits.endsWith('@c.us') ? rawDigits : `${rawDigits}@c.us`;

  // Find active device for sending
  const device = await prisma.device.findFirst({
    where: { status: 'connected' },
    orderBy: { updatedAt: 'desc' }
  });

  if (!device) {
    console.warn('[Zapier Engine] No connected device found to dispatch automation message.');
  }

  const tenantId = payload.tenant_id || device?.tenantId;
  if (!tenantId) {
    throw new Error('Tenant ID not resolved for automation webhook processing.');
  }

  const currentStatus = (payload.status || payload.event_type || 'ANY').toUpperCase();

  // Special Auto-Cancel Case: If order status changes to RETURNED, cancel any pending OVERDUE reminders for this order
  if (currentStatus === 'RETURNED' && payload.order_id) {
    await prisma.scheduledNotification.updateMany({
      where: {
        tenantId,
        orderId: payload.order_id,
        status: 'PENDING'
      },
      data: {
        status: 'CANCELLED'
      }
    });
    console.log(`[Zapier Engine] Cancelled pending notifications for returned order ${payload.order_id}`);
  }

  // Retrieve active automation rules for this tenant
  const rules = await prisma.automationRule.findMany({
    where: {
      tenantId,
      isEnabled: true
    },
    include: {
      template: true
    }
  });

  const executedRules: any[] = [];

  for (const rule of rules) {
    let shouldTrigger = false;

    if (rule.triggerType === 'EVENT_STATUS_CHANGED') {
      if (rule.targetStatus === 'ANY' || rule.targetStatus === currentStatus) {
        shouldTrigger = true;
      }
    } else if ((rule.triggerType === 'TIME_DUE_COUNTDOWN' || rule.triggerType === 'TIME_OVERDUE') && payload.due_datetime) {
      shouldTrigger = true;
    }

    if (!shouldTrigger) continue;

    // Calculate scheduled time
    let scheduledTime = new Date();

    if ((rule.triggerType === 'TIME_DUE_COUNTDOWN' || rule.triggerType === 'TIME_OVERDUE') && payload.due_datetime) {
      const baseDate = new Date(payload.due_datetime);
      let offsetMs = rule.offsetValue * 60 * 1000;
      if (rule.offsetUnit === 'HOURS') offsetMs = rule.offsetValue * 3600 * 1000;
      if (rule.offsetUnit === 'DAYS') offsetMs = rule.offsetValue * 86400 * 1000;

      if (rule.offsetDirection === 'BEFORE') {
        scheduledTime = new Date(baseDate.getTime() - offsetMs);
      } else if (rule.offsetDirection === 'AFTER') {
        scheduledTime = new Date(baseDate.getTime() + offsetMs);
      } else {
        scheduledTime = baseDate;
      }
    }

    // Apply Quiet Hours adjustment (08:00 - 20:00)
    scheduledTime = enforceQuietHours(
      scheduledTime,
      rule.quietHoursStart || '20:00',
      rule.quietHoursEnd || '08:00'
    );

    // Compile template text
    const renderedText = compileTemplateText(rule.template.templateText, payload.data || {});

    // Check if immediate execution (scheduled within 10 seconds of now)
    const isImmediate = Math.abs(scheduledTime.getTime() - Date.now()) < 10000;

    if (isImmediate && device) {
      // Execute immediately via WahaAdapter
      try {
        const wahaAdapter = new WahaAdapter();
        const sessId = device.deviceIdentifier;
        await wahaAdapter.sendMessage(sessId, recipientJid, renderedText);

        // Record in ScheduledNotification log as SENT
        const notif = await prisma.scheduledNotification.create({
          data: {
            tenantId,
            deviceId: device.id,
            ruleId: rule.id,
            orderId: payload.order_id || null,
            recipient: recipientJid,
            eventKey: currentStatus,
            renderedText,
            scheduledAt: scheduledTime,
            sentAt: new Date(),
            status: 'SENT',
            metadata: payload.data || {}
          }
        });
        executedRules.push({ ruleId: rule.id, ruleName: rule.name, status: 'SENT', notificationId: notif.id });
      } catch (err: any) {
        console.error(`[Zapier Engine] Failed to dispatch immediate rule ${rule.name}:`, err);
        const notif = await prisma.scheduledNotification.create({
          data: {
            tenantId,
            deviceId: device?.id || null,
            ruleId: rule.id,
            orderId: payload.order_id || null,
            recipient: recipientJid,
            eventKey: currentStatus,
            renderedText,
            scheduledAt: scheduledTime,
            status: 'FAILED',
            lastError: err.message,
            metadata: payload.data || {}
          }
        });
        executedRules.push({ ruleId: rule.id, ruleName: rule.name, status: 'FAILED', error: err.message, notificationId: notif.id });
      }
    } else {
      // Queue in ScheduledNotification table for BullMQ Cron Worker
      const notif = await prisma.scheduledNotification.create({
        data: {
          tenantId,
          deviceId: device?.id || null,
          ruleId: rule.id,
          orderId: payload.order_id || null,
          recipient: recipientJid,
          eventKey: currentStatus,
          renderedText,
          scheduledAt: scheduledTime,
          status: 'PENDING',
          metadata: payload.data || {}
        }
      });
      executedRules.push({ ruleId: rule.id, ruleName: rule.name, status: 'SCHEDULED', scheduledAt: scheduledTime, notificationId: notif.id });
    }
  }

  return {
    processedCount: executedRules.length,
    rules: executedRules
  };
}
