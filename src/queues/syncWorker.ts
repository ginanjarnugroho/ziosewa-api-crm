import { Worker, Job, Queue } from 'bullmq';
import { redisConnection } from './connection';
import { prisma } from '../repositories/prisma';
import { io } from '../server';
import axios from 'axios';
import { uploadFromUrl, getExtFromUrl } from '../services/gcsService';

export const syncQueue = new Queue('syncQueue', { connection: redisConnection });

const WAHA_URL = process.env.WAHA_URL || 'http://localhost:3001';
const WAHA_API_KEY = process.env.WAHA_API_KEY || 'waha_secret_key';

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Api-Key': WAHA_API_KEY
  };
}

export const syncWorker = new Worker('syncQueue', async (job: Job) => {
  const { deviceId, tenantId, deviceIdentifier } = job.data as {
    deviceId: string;
    tenantId: string;
    deviceIdentifier: string; // The session name in WAHA
  };

  const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

  try {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device || device.status !== 'connected') {
      // Force frontend to redirect to QR scan page
      io.to(`tenant_${tenantId}`).emit('connection_update', {
        device_id: deviceId,
        status: 'disconnected'
      });
      throw new Error(`Perangkat tidak terhubung (status: ${device?.status || 'unknown'}). Sinkronisasi dibatalkan.`);
    }

    console.log(`[Sync Worker] Starting sync for device ${deviceId} (WAHA session: ${deviceIdentifier})`);
    
    // Notify frontend that sync has started
    io.to(`tenant_${tenantId}`).emit('history_sync_progress', {
      device_id: deviceId,
      status: 'downloading',
      message: 'Memulai sinkronisasi...'
    });

    // 1. Fetch all chats from WAHA using standard chats endpoint
    const chatsRes = await axios.get(`${WAHA_URL}/api/${deviceId}/chats?limit=1000`, {
      headers: getHeaders()
    });
    
    const chats = chatsRes.data || [];
    const totalChats = chats.length;
    
    console.log(`[Sync Worker] Found ${totalChats} chats to sync.`);

    io.to(`tenant_${tenantId}`).emit('history_sync_progress', {
      device_id: deviceId,
      status: 'processing',
      message: `Ditemukan ${totalChats} obrolan. Mulai menarik pesan...`,
      progress: 0,
      total: totalChats
    });

    let chatsProcessed = 0;

    // 2. Iterate through each chat
    for (const chat of chats) {
      const remoteJid = (chat.id || '').replace('@s.whatsapp.net', '@c.us');
      let pushName = chat.name || chat.pushname || chat.verifiedName || remoteJid;

      // Ensure Contact exists
      await prisma.contact.upsert({
        where: { deviceId_remoteJid: { deviceId, remoteJid } },
        create: { tenantId, deviceId, remoteJid, pushName },
        update: { pushName } // Update name if it changed
      });

      chatsProcessed++;

      // Throttle requests to prevent WhatsApp Web rate limits / session pause
      await new Promise(r => setTimeout(r, 300));

      // Fetch the latest message for this chat to populate the inbox list
      try {
        const msgRes = await axios.get(`${WAHA_URL}/api/${deviceId}/chats/${encodeURIComponent(remoteJid)}/messages?limit=1`, {
          headers: getHeaders()
        });
        const msgs = msgRes.data || [];
        if (msgs.length > 0) {
          const m = msgs[0];
          await prisma.chatMessage.upsert({
            where: { deviceId_remoteJid_messageId: { deviceId, remoteJid, messageId: m.id } },
            create: {
              tenantId,
              deviceId,
              remoteJid,
              messageId: m.id,
              isFromMe: m.fromMe,
              text: m.body || '',
              messageType: m.type || 'text',
              timestamp: new Date(m.timestamp * 1000),
              status: m.ack === 1 ? 'sent' : m.ack === 2 ? 'delivered' : m.ack >= 3 ? 'read' : 'queued'
            },
            update: {
              status: m.ack === 1 ? 'sent' : m.ack === 2 ? 'delivered' : m.ack >= 3 ? 'read' : 'queued'
            }
          });
        }
      } catch (err: any) {
        console.warn(`[Sync Worker] Failed to fetch latest message for ${remoteJid}:`, err.response?.data || err.message);
      }

      // Notify Frontend about the newly synced chat
      // We send a lightweight event so FE can refresh the chat list if needed
      io.to(`tenant_${tenantId}`).emit('sync_new_chat', {
        device_id: deviceId,
        remote_jid: remoteJid,
        push_name: pushName,
        messages_synced: 0 // lazy loaded
      });

      // Update progress
      io.to(`tenant_${tenantId}`).emit('history_sync_progress', {
        device_id: deviceId,
        status: 'processing',
        message: `Menyinkronkan kontak: ${chatsProcessed} / ${totalChats}...`,
        progress: chatsProcessed,
        total: totalChats
      });

      // SLEEP 10ms (much faster since no messages fetched)
      await delay(10);
    }

    console.log(`[Sync Worker] Sync completed for ${deviceId}`);
    
    io.to(`tenant_${tenantId}`).emit('history_sync_progress', {
      device_id: deviceId,
      status: 'completed',
      message: 'Sinkronisasi riwayat obrolan selesai!'
    });

    return { success: true, processed: chatsProcessed };
  } catch (err: any) {
    console.error(`[Sync Worker] Failed:`, err.message);
    io.to(`tenant_${tenantId}`).emit('history_sync_progress', {
      device_id: deviceId,
      status: 'error',
      message: 'Gagal menyinkronkan data.'
    });
    throw err;
  }
}, {
  connection: redisConnection,
  concurrency: 1 // Only 1 sync job at a time to prevent WAHA overload
});

syncWorker.on('completed', job => {
  console.log(`[BullMQ] Sync Job ${job.id} completed successfully`);
});
syncWorker.on('failed', (job, err) => {
  console.error(`[BullMQ] Sync Job ${job?.id} failed: ${err.message}`);
});
