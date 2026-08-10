import { Worker, Job, Queue } from 'bullmq';
import { redisConnection } from './connection';
import { prisma } from '../repositories/prisma';
import { io } from '../server';
import axios from 'axios';
import { uploadBuffer, getExtFromUrl } from '../services/gcsService';

// Initialize the queue
export const mediaDownloadQueue = new Queue('mediaDownloadQueue', { connection: redisConnection });

// Worker options
const workerOptions = {
  connection: redisConnection,
  concurrency: 2 // Max 2 concurrent downloads so we don't overload WAHA/GCS
};

export const mediaDownloadWorker = new Worker('mediaDownloadQueue', async (job: Job) => {
  const { deviceId, tenantId, remoteJid, messageId } = job.data as {
    deviceId: string;
    tenantId: string;
    remoteJid: string;
    messageId: string;
  };

  try {
    const chatMsg = await prisma.chatMessage.findUnique({
      where: { deviceId_remoteJid_messageId: { deviceId, remoteJid, messageId } }
    });

    if (!chatMsg) {
      console.warn(`[Media Worker] Message ${messageId} not found in DB, skipping.`);
      return { success: false, reason: 'message_not_found' };
    }

    if (chatMsg.mediaUrl) {
      console.log(`[Media Worker] Message ${messageId} already has mediaUrl, skipping.`);
      return { success: true, reason: 'already_downloaded' };
    }

    console.log(`[Media Worker] Downloading media for message ${messageId}...`);

    const wahaUrl = process.env.WAHA_URL || 'http://localhost:3001';
    const wahaApiKey = process.env.WAHA_API_KEY || 'waha_secret_key';
    const downloadUrl = `${wahaUrl}/api/${deviceId}/messages/${messageId}/download`;
    
    const response = await axios.get(downloadUrl, {
      headers: {
        'X-Api-Key': wahaApiKey,
        'Accept': 'application/json'
      },
      responseType: 'arraybuffer'
    });

    let buffer: Buffer;
    let mimetype = 'application/octet-stream';
    let filename = `${messageId}.bin`;

    if ((response.headers['content-type'] as string)?.includes('application/json')) {
       const data = JSON.parse(response.data.toString('utf8'));
       buffer = Buffer.from(data.data || data.base64 || '', 'base64');
       mimetype = data.mimetype;
       filename = data.filename || `${messageId}`;
    } else {
       buffer = Buffer.from(response.data);
       mimetype = (response.headers['content-type'] as string) || mimetype;
       const mimeToExt: any = {
         'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
         'video/mp4': '.mp4', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg',
         'application/pdf': '.pdf'
       };
       filename = `${messageId}${mimeToExt[mimetype] || '.bin'}`;
    }

    const gcsPath = `inbound-media/${deviceId}/${filename}`;
    const mediaGcsUrl = await uploadBuffer(buffer, gcsPath, mimetype);
    
    console.log(`[Media Worker] Uploaded media for ${messageId}:`, mediaGcsUrl);

    // Update the message in DB
    const updatedMsg = await prisma.chatMessage.update({
      where: { deviceId_remoteJid_messageId: { deviceId, remoteJid, messageId } },
      data: { mediaPath: mediaGcsUrl }
    });

    // Notify frontend to update the specific message bubble
    io.to(`tenant_${tenantId}`).emit('chat_message_updated', {
      device_id: deviceId,
      remote_jid: remoteJid,
      messageId: messageId,
      mediaPath: mediaGcsUrl
    });

    return { success: true, mediaUrl: mediaGcsUrl };
  } catch (err: any) {
    console.error(`[Media Worker] Failed to download media for ${messageId}:`, err.message);
    
    if (err.response?.status === 404) {
      // WAHA doesn't have this historical message in cache to download media
      console.warn(`[Media Worker] Media for ${messageId} is expired/unavailable on WAHA. Marking as unavailable.`);
      
      const msgRecord = await prisma.chatMessage.findUnique({
        where: { deviceId_remoteJid_messageId: { deviceId, remoteJid, messageId } },
        select: { mediaUrl: true }
      });

      let finalMediaUrl = 'unavailable';
      if (msgRecord?.mediaUrl && msgRecord.mediaUrl.startsWith('data:image')) {
        finalMediaUrl = msgRecord.mediaUrl; // Keep the low-res thumbnail!
        console.log(`[Media Worker] Message ${messageId} has a thumbnail. Keeping thumbnail instead of marking unavailable.`);
      }

      await prisma.chatMessage.update({
        where: { deviceId_remoteJid_messageId: { deviceId, remoteJid, messageId } },
        data: { mediaUrl: finalMediaUrl }
      });

      io.to(`tenant_${tenantId}`).emit('chat_message_updated', {
        device_id: deviceId,
        remote_jid: remoteJid,
        messageId: messageId,
        mediaUrl: finalMediaUrl
      });
      return { success: false, reason: 'unavailable' };
    }

    if (err.response?.status === 429) {
      // Re-throw to trigger BullMQ retry on rate limit
      throw err;
    }
    // If it's 404 or other error, we don't retry to avoid infinite loops on broken media
    return { success: false, error: err.message };
  }
}, workerOptions);

mediaDownloadWorker.on('completed', job => {
  console.log(`[BullMQ] Media Download Job ${job.id} completed successfully`);
});

mediaDownloadWorker.on('failed', (job, err) => {
  console.error(`[BullMQ] Media Download Job ${job?.id} failed: ${err.message}`);
});
