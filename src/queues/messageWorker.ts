import { Worker, Job, Queue } from 'bullmq';
import { redisConnection } from './connection';
import { AdapterFactory } from '../services/AdapterFactory';
import { SendMessagePayload } from '../interfaces/MessagingChannelAdapter';
import { prisma } from '../repositories/prisma';
import { io } from '../server';
import { getSignedUrl } from '../services/gcsService';

export const messageQueue = new Queue('messageQueue', { connection: redisConnection });

export const messageWorker = new Worker('messageQueue', async (job: Job) => {
  const { deviceId, channelType, payload, logId } = job.data as any;

  try {
    const adapter = AdapterFactory.getAdapter(channelType);
    let response;

    if (job.name === 'sendMedia') {
      response = await adapter.sendMedia!(deviceId, payload);
    } else {
      response = await adapter.sendText(deviceId, payload);
    }
    
    // Attempt to extract messageId from WAHA response
    // WAHA might return the ID as a string, or an object { _serialized: "...", id: "..." }

    let messageId = `temp-${Date.now()}`;
    if (response) {
      if (typeof response.id === 'string') {
        messageId = response.id;
      } else if (response.id && typeof response.id === 'object') {
        messageId = response.id._serialized || response.id.id || messageId;
      } else if (response.messageId) {
        messageId = response.messageId;
      }
    }

    // Update DB status to 'sent'
    if (logId) {
      await prisma.messageLog.update({
        where: { id: logId },
        data: { status: 'sent' }
      });
    }

    // Create ChatMessage in the database so we can track its status
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (device) {
      const chatMsg = await prisma.chatMessage.create({
        data: {
          tenantId: device.tenantId,
          deviceId: deviceId,
          remoteJid: payload.to,
          messageId: messageId,
          isFromMe: true,
          text: payload.caption || payload.message || '',
          messageType: job.name === 'sendMedia' ? 'media' : 'text',
          mediaUrl: payload.url || null,
          timestamp: new Date(),
          status: 'sent' // Initial status
        }
      });

      if (chatMsg.mediaUrl && chatMsg.mediaUrl.includes('storage.googleapis.com')) {
        try {
          chatMsg.mediaUrl = await getSignedUrl(chatMsg.mediaUrl);
        } catch (e) {
          console.error('[MessageWorker] Failed to sign mediaUrl for websocket:', e);
        }
      }

      // Emit to frontend to replace temp message with real message
      io.to(`tenant_${device.tenantId}`).emit('message_sent', {
        tempId: payload.idempotency_key, // Passed from frontend
        message: chatMsg
      });
    }

    return { success: true };
  } catch (err: any) {
    const errorMessage = err.message || '';
    
    // Circuit Breaker Logic
    if (errorMessage.includes('429') || errorMessage.includes('rate limit') || errorMessage.includes('spam')) {
      console.warn(`[Circuit Breaker] Rate limit detected for device ${deviceId}. Pausing message queue for 60 seconds.`);
      await messageQueue.pause();
      setTimeout(async () => {
        console.log(`[Circuit Breaker] Resuming message queue...`);
        await messageQueue.resume();
      }, 60000);
      
      // Delay this specific job via retry
      throw new Error(`RateLimitError: ${errorMessage}`);
    }

    if (logId) {
      await prisma.messageLog.update({
        where: { id: logId },
        data: { status: 'failed', payload: { ...payload, error: errorMessage } as any }
      });
    }
    throw new Error(`Failed to send message: ${errorMessage}`);
  }
}, {
  connection: redisConnection,
  limiter: {
    max: 5, // Rate limit for anti-ban
    duration: 1000 // 5 messages per second across all workers
  }
});

messageWorker.on('completed', job => {
  console.log(`[BullMQ] Job ${job.id} completed successfully`);
});
messageWorker.on('failed', (job, err) => {
  console.error(`[BullMQ] Job ${job?.id} failed: ${err.message}`);
});
