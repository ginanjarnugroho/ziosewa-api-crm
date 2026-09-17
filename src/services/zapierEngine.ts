import { CloudTasksService } from './CloudTasksService';
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
    tgl_acara?: string;
    tgl_ambil?: string;
    tgl_kembali?: string;
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
    '{tgl_acara}': data.tgl_acara || '-',
    '{tgl_ambil}': data.tgl_ambil || '-',
    '{tgl_kembali}': data.tgl_kembali || '-',
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

export function parseBaseDate(val: any, fallbackDate?: Date): Date | null {
  if (!val) return fallbackDate || null;
  if (val instanceof Date && !isNaN(val.getTime())) return val;
  if (typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? (fallbackDate || null) : d;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) return parsed;

    // Handle Indonesian or custom date string like "10 Aug 2026" or "12 Aug 2026 18:00"
    const monthsMap: Record<string, string> = {
      'Jan': 'Jan', 'Feb': 'Feb', 'Mar': 'Mar', 'Apr': 'Apr', 'Mei': 'May', 'Jun': 'Jun',
      'Jul': 'Jul', 'Agu': 'Aug', 'Agt': 'Aug', 'Sep': 'Sep', 'Okt': 'Oct', 'Nov': 'Nov', 'Des': 'Dec'
    };
    let normalized = trimmed;
    for (const [idMonth, enMonth] of Object.entries(monthsMap)) {
      normalized = normalized.replace(new RegExp(`\\b${idMonth}\\b`, 'i'), enMonth);
    }
    const idParsed = new Date(normalized);
    if (!isNaN(idParsed.getTime())) return idParsed;
  }
  return fallbackDate || null;
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
  let rawDigits = payload.customer_phone.replace(/\D/g, '');
  if (rawDigits.startsWith('0')) {
    rawDigits = '62' + rawDigits.slice(1);
  }
  const recipientJid = rawDigits.endsWith('@c.us') ? rawDigits : `${rawDigits}@c.us`;

  // Find active device for sending
  const device = await prisma.device.findFirst({
    where: { status: 'connected' },
    orderBy: { updatedAt: 'desc' }
  });

  if (!device) {
    console.warn('[ZioSewa Engine] No connected device found to dispatch automation message.');
  }

  const tenantId = payload.tenant_id || device?.tenantId;
  if (!tenantId) {
    throw new Error('Tenant ID not resolved for automation webhook processing.');
  }

  const currentStatus = (payload.status || payload.event_type || 'ANY').toUpperCase();

  // Special Auto-Cancel Case: If order status changes to RETURNED or COMPLETED, cancel any pending reminders for this order
  if ((currentStatus === 'RETURNED' || currentStatus === 'COMPLETED') && payload.order_id) {
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
    console.log(`[ZioSewa Engine] Cancelled pending notifications for returned/completed order ${payload.order_id}`);
  }

  // Retrieve active automation rules for this tenant
  const rules = await prisma.automationRule.findMany({
    where: {
      tenantId,
      isEnabled: true
    },
    include: {
      template: true,
      device: true
    }
  });

  const executedRules: any[] = [];

  for (const rule of rules) {
    let shouldTrigger = false;
    const statusMatches = rule.targetStatus === 'ANY' || rule.targetStatus === currentStatus;

    if (rule.triggerType === 'EVENT_STATUS_CHANGED') {
      if (statusMatches) {
        shouldTrigger = true;
      }
    } else if (rule.triggerType === 'TIME_DUE_COUNTDOWN' || rule.triggerType === 'TIME_OVERDUE') {
      if (statusMatches) {
        let targetRawDate: any = null;
        if (rule.baseDateKey && payload.data && payload.data[rule.baseDateKey]) {
          targetRawDate = payload.data[rule.baseDateKey];
        } else if (rule.baseDateKey && (payload as any)[rule.baseDateKey]) {
          targetRawDate = (payload as any)[rule.baseDateKey];
        } else {
          targetRawDate = payload.due_datetime;
        }

        const resolvedBaseDate = parseBaseDate(targetRawDate, payload.due_datetime ? new Date(payload.due_datetime) : undefined);
        if (resolvedBaseDate || rule.offsetDirection === 'IMMEDIATE') {
          shouldTrigger = true;
        }
      }
    }

    if (!shouldTrigger) continue;

    // Resolve specific target device for this rule (fallback to default active device)
    let targetDevice = rule.device;
    if (!targetDevice || targetDevice.status !== 'connected') {
      targetDevice = device;
    }

    // Extract base date for rule scheduling
    let baseRawDate: any = null;
    if (rule.baseDateKey && payload.data && payload.data[rule.baseDateKey]) {
      baseRawDate = payload.data[rule.baseDateKey];
    } else if (rule.baseDateKey && (payload as any)[rule.baseDateKey]) {
      baseRawDate = (payload as any)[rule.baseDateKey];
    } else {
      baseRawDate = payload.due_datetime;
    }

    const baseDate = parseBaseDate(baseRawDate, payload.due_datetime ? new Date(payload.due_datetime) : new Date()) || new Date();

    // Calculate scheduled time based on offsetDirection
    let scheduledTime = new Date();

    if (rule.offsetDirection === 'IMMEDIATE') {
      scheduledTime = new Date();
    } else if (rule.offsetDirection === 'FIXED_TIME') {
      scheduledTime = new Date(baseDate.getTime());
      const fixedTimeStr = rule.fixedTime || '09:00';
      const [hStr, mStr] = fixedTimeStr.split(':');
      const hours = parseInt(hStr, 10) || 9;
      const minutes = parseInt(mStr, 10) || 0;
      scheduledTime.setHours(hours, minutes, 0, 0);
    } else {
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

    if (isImmediate && targetDevice && targetDevice.status === 'connected') {
      // Execute immediately via WahaAdapter
      try {
        const wahaAdapter = new WahaAdapter();
        const sessId = targetDevice.id;
        await wahaAdapter.sendMessage(sessId, recipientJid, renderedText);
        console.log(`[ZioSewa Engine] Immediate rule ${rule.name} executed successfully via device ${sessId}`);

        // Record in ScheduledNotification log as SENT
        const notif = await prisma.scheduledNotification.create({
          data: {
            tenantId,
            deviceId: targetDevice.id,
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
        console.error(`[ZioSewa Engine] Failed to dispatch immediate rule ${rule.name}:`, err);
        const notif = await prisma.scheduledNotification.create({
          data: {
            tenantId,
            deviceId: targetDevice?.id || null,
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
      // Queue in ScheduledNotification table
      const notif = await prisma.scheduledNotification.create({
        data: {
          tenantId,
          deviceId: targetDevice?.id || null,
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

      // If Cloud Tasks is configured, schedule serverless execution
      try {
        await CloudTasksService.enqueueTask(
          '/api/v1/internal/tasks/process-automation',
          { notificationId: notif.id, deviceId: targetDevice?.id },
          scheduledTime
        );
      } catch (ctErr: any) {
        console.log('[ZioSewa Engine] Cloud Tasks scheduling skipped/fallback to DB poller:', ctErr.message);
      }

      executedRules.push({ ruleId: rule.id, ruleName: rule.name, status: 'SCHEDULED', scheduledAt: scheduledTime, notificationId: notif.id });
    }
  }

  return {
    processedCount: executedRules.length,
    rules: executedRules
  };
}
