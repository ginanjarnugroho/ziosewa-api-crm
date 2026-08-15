import { CloudTasksService } from './CloudTasksService';
import { prisma } from '../repositories/prisma';
import { WahaAdapter } from '../adapters/WahaAdapter';

const wahaAdapter = new WahaAdapter();

export async function processBroadcastCampaign(campaignId: string) {
  try {
    // Mark as processing
    await prisma.broadcastCampaign.update({
      where: { id: campaignId },
      data: { status: 'PROCESSING' }
    });

    const campaign = await prisma.broadcastCampaign.findUnique({
      where: { id: campaignId },
      include: {
        template: true,
        targets: {
          where: { status: 'PENDING' }
        }
      }
    });

    if (!campaign || !campaign.template) return;

    let successCount = 0;
    let failedCount = 0;

    for (const target of campaign.targets) {
      try {
        let text = campaign.template.templateText;

        // Replace variables e.g. {{nama}}
        if (target.variables && typeof target.variables === 'object') {
          const vars = target.variables as Record<string, string>;
          for (const key of Object.keys(vars)) {
            const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
            text = text.replace(regex, vars[key]);
          }
        }

        if (campaign.deviceId) {
           await wahaAdapter.sendMessage(campaign.deviceId, target.phone, text);
        } else {
           // If no deviceId specified on campaign, find the first connected device for this tenant
           const device = await prisma.device.findFirst({
             where: { tenantId: campaign.tenantId, status: 'connected' }
           });
           if (!device) throw new Error('No connected device found for tenant');
           await wahaAdapter.sendMessage(device.id, target.phone, text);
        }

        // Update target status
        await prisma.broadcastTarget.update({
          where: { id: target.id },
          data: { status: 'SENT', sentAt: new Date() }
        });
        successCount++;

      } catch (err: any) {
        console.error(`[Broadcast] Failed to send to ${target.phone}:`, err.message);
        await prisma.broadcastTarget.update({
          where: { id: target.id },
          data: { status: 'FAILED', errorMessage: err.message }
        });
        failedCount++;
      }

      // Delay to avoid spamming WAHA and getting banned (e.g. 2000ms)
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Finalize campaign
    await prisma.broadcastCampaign.update({
      where: { id: campaignId },
      data: {
        status: 'COMPLETED',
        successCount: { increment: successCount },
        failedCount: { increment: failedCount }
      }
    });

  } catch (error) {
    console.error(`[Broadcast] Critical error processing campaign ${campaignId}:`, error);
    await prisma.broadcastCampaign.update({
      where: { id: campaignId },
      data: { status: 'FAILED' }
    });
  }
}
