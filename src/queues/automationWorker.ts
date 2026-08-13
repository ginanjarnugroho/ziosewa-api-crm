import { prisma } from '../repositories/prisma';
import { WahaAdapter } from '../adapters/WahaAdapter';
import { enforceQuietHours } from '../services/zapierEngine';
import { formatHumanError } from '../utils/errorUtils';

let isRunning = false;

export async function processScheduledNotifications() {
  if (isRunning) return;
  isRunning = true;

  try {
    const now = new Date();

    // Fetch pending notifications scheduled for now or earlier with resilient error handling
    let pendingNotifs: any[] = [];
    try {
      pendingNotifs = await prisma.scheduledNotification.findMany({
        where: {
          status: 'PENDING',
          scheduledAt: { lte: now }
        },
        take: 20,
        orderBy: { scheduledAt: 'asc' }
      });
    } catch (dbErr: any) {
      console.warn('[Automation Worker Warning] Database connection busy or temporary timeout, retrying next cycle:', dbErr?.message || dbErr);
      return;
    }

    if (pendingNotifs.length === 0) {
      return;
    }

    const device = await prisma.device.findFirst({
      where: { status: 'connected' },
      orderBy: { updatedAt: 'desc' }
    });

    if (!device) {
      return;
    }

    const wahaAdapter = new WahaAdapter();

    for (const notif of pendingNotifs) {
      // Re-verify quiet hours before sending
      const adjustedTime = enforceQuietHours(new Date(), '20:00', '08:00');
      const isNight = adjustedTime.getTime() > Date.now() + 60000;

      if (isNight) {
        // Postpone to next morning
        await prisma.scheduledNotification.update({
          where: { id: notif.id },
          data: { scheduledAt: adjustedTime }
        });
        console.log(`[Automation Worker] Deferred notification ${notif.id} to ${adjustedTime.toISOString()} due to Quiet Hours.`);
        continue;
      }

      try {
        await wahaAdapter.sendMessage(device.id, notif.recipient, notif.renderedText);

        await prisma.scheduledNotification.update({
          where: { id: notif.id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            lastError: null
          }
        });
        console.log(`[Automation Worker] Successfully sent automated message to ${notif.recipient}`);
      } catch (err: any) {
        const humanError = formatHumanError(err);
        const nextRetryCount = notif.retryCount + 1;
        const isMaxRetries = nextRetryCount >= 3;

        await prisma.scheduledNotification.update({
          where: { id: notif.id },
          data: {
            status: isMaxRetries ? 'FAILED' : 'PENDING',
            retryCount: nextRetryCount,
            lastError: humanError,
            // Retry in 2 minutes if under max retries
            scheduledAt: isMaxRetries ? notif.scheduledAt : new Date(Date.now() + 2 * 60 * 1000)
          }
        });
        console.error(`[Automation Worker] Failed dispatch for ${notif.id} (attempt ${nextRetryCount}/3):`, humanError);
      }
    }
  } catch (err) {
    console.error('[Automation Worker Error]', err);
  } finally {
    isRunning = false;
  }
}

export function startAutomationScheduler(intervalMs = 30000) {
  console.log(`[Automation Scheduler] Started background polling worker (every ${intervalMs / 1000}s)...`);
  setInterval(() => {
    processScheduledNotifications().catch(e => console.error('[Scheduler Interval Error]', e));
  }, intervalMs);
}
