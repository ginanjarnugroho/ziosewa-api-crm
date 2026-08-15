import { CloudTasksService } from '../services/CloudTasksService';
import { FastifyInstance } from 'fastify';
import axios from 'axios';
import { AdapterFactory } from '../services/AdapterFactory';
import { getSignedUrl, uploadJson, readJson } from '../services/gcsService';
import { normalizeJid, formatPhoneNumber } from '../utils/phoneUtils';
import { config } from '../config/env';

import { findDeviceByIdentifier } from '../repositories/deviceRepository';
import { 
  getLatestChatsWithPagination, 
  countDistinctChats, 
  findMessagesByChat, 
  markMessagesAsRead, 
  findLatestUnreadMessage, 
  getMediaGalleryByChat,
  upsertMessage
} from '../repositories/chatMessageRepository';
import { 
  findContactsByJids, 
  findContactByJid, 
  upsertContactProfilePic,
  upsertContact,
  findContactByRemoteJidOnly
} from '../repositories/contactRepository';

export default async function chatController(fastify: FastifyInstance) {
  fastify.get('/api/v1/chats', {
    schema: {
      description: 'Get list of chats (latest message per contact)',
      tags: ['Chats'],
      querystring: {
        type: 'object',
        required: ['tenant_id', 'device_id'],
        properties: {
          tenant_id: { type: 'string' },
          device_id: { type: 'string' },
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 50 }
        }
      }
    }
  }, async (request, reply) => {
    const { tenant_id, device_id } = request.query as any;
    const page = Number((request.query as any).page) || 1;
    const limit = Number((request.query as any).limit) || 50;

    try {
      // 1. Dapatkan referensi Device
      const device = await findDeviceByIdentifier(device_id, tenant_id);
      if (!device) return reply.status(404).send({ success: false, error: 'Device not found' });

      const offset = (page - 1) * limit;
      
      // 2. Gunakan fungsi repositori (Repository Layer) untuk mengeksekusi Raw SQL
      const latestMessagesRaw = await getLatestChatsWithPagination(device.tenantId, device.id, limit, offset);
      const total = await countDistinctChats(device.tenantId, device.id);

      // Mapping hasil query Raw SQL PostgreSQL ke dalam bentuk CamelCase objek standar
      const latestMessages = latestMessagesRaw.map(msg => ({
        remoteJid: msg.remote_jid,
        text: msg.text,
        isFromMe: msg.is_from_me,
        timestamp: new Date(msg.timestamp),
        status: msg.status
      }));

      // 3. Tarik data profil (nama, foto) untuk tiap JID yang sedang dimuat
      const contacts = await findContactsByJids(
        tenant_id, 
        device.id, 
        latestMessages.map(m => m.remoteJid)
      );

      const contactMap = new Map(contacts.map(c => [c.remoteJid, c]));

      const adapter = AdapterFactory.getAdapter(device.channelType) as any;
      const socket = adapter?.getSocket ? adapter.getSocket(device.id) : null;

      const chats = await Promise.all(latestMessages.map(async msg => {
        const contact = contactMap.get(msg.remoteJid);
        let name = contact?.pushName || contact?.verifiedName || null;

        // Mengecek nama grup (Group Subject) langsung ke WhatsApp API jika database kita belum menyimpannya
        if (!name && msg.remoteJid.endsWith('@g.us')) {
          const WAHA_URL = config.wahaUrl;
          const WAHA_API_KEY = config.wahaApiKey;
          const sessId = device.id || device.deviceIdentifier;
          
          axios.get(`${WAHA_URL}/api/${sessId}/chats/${encodeURIComponent(msg.remoteJid)}`, {
            headers: { 'X-Api-Key': WAHA_API_KEY },
            timeout: 1500
          }).then(res => {
            const realGroupName = res.data?.name || res.data?.subject;
            if (realGroupName) {
               upsertContact(device.id, msg.remoteJid, device.tenantId, realGroupName).catch(() => {});
            }
          }).catch(() => {});
        }

        // Always use our backend proxy endpoint for profile_pic so we can generate fresh Signed URLs on the fly
        const baseUrl = `${request.protocol}://${request.headers.host}`;
        let profile_pic = `${baseUrl}/api/v1/contacts/${msg.remoteJid}/avatar?tenant_id=${tenant_id}&device_id=${device_id}`;
        if (contact?.profilePic === 'none') {
          profile_pic = null as any; // Explicitly no avatar
        }

        const formattedPhone = formatPhoneNumber(msg.remoteJid);
        const displayName = (name && name.trim() && !name.includes('@c.us') && !name.includes('@g.us')) ? name.trim() : formattedPhone;

        return {
          remote_jid: msg.remoteJid,
          name: displayName,
          phone: formattedPhone,
          profile_pic: profile_pic,
          latest_message: {
            text: msg.text,
            is_from_me: msg.isFromMe,
            timestamp: msg.timestamp,
            status: msg.status
          }
        };
      }));

      return {
        success: true,
        data: chats,
        meta: {
          page,
          limit,
          total
        }
      };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  fastify.get('/api/v1/contacts/:remoteJid/avatar', {
    schema: {
      description: 'Get profile picture for a contact',
      tags: ['Contacts'],
      params: {
        type: 'object',
        required: ['remoteJid'],
        properties: {
          remoteJid: { type: 'string' }
        }
      },
      querystring: {
        type: 'object',
        required: ['tenant_id', 'device_id'],
        properties: {
          tenant_id: { type: 'string' },
          device_id: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { remoteJid } = request.params as any;
    const { tenant_id, device_id } = request.query as any;

    try {
      const device = await findDeviceByIdentifier(device_id, tenant_id);
      if (!device) return reply.status(404).send({ success: false, error: 'Device not found' });

      // Periksa cache database terlebih dahulu agar tidak membebani limit API WhatsApp
      const contact = await findContactByJid(device.id, remoteJid);

      if (contact?.profilePic && contact.profilePic.startsWith('http')) {
        try {
          const signedUrl = await getSignedUrl(contact.profilePic);
          return reply.redirect(signedUrl);
        } catch (e) {
          console.error('[Avatar] Failed to generate signed URL:', e);
          return reply.redirect(contact.profilePic); // Fallback to raw public URL if signing fails
        }
      }

      // If device is not connected, skip WAHA API call to prevent error spam
      if (device.status !== 'connected') {
        return reply.status(404).send({ success: false, error: 'Device is not connected, skipping avatar fetch' });
      }

      // Jika tidak ada di lokal DB, maka tarik via WebSocket/Adapter WhatsApp
      const adapter = AdapterFactory.getAdapter(device.channelType) as any;
      if (adapter && typeof adapter.getProfilePicUrl === 'function') {
        const picUrl = await adapter.getProfilePicUrl(device.id, remoteJid);
        if (picUrl) {
          await upsertContactProfilePic(device.tenantId, device.id, remoteJid, picUrl);
          return reply.redirect(picUrl);
        } else {
          await upsertContactProfilePic(device.tenantId, device.id, remoteJid, 'none');
          return reply.status(404).send({ success: false, error: 'No profile picture' });
        }
      }

      return reply.status(404).send({ success: false, error: 'No profile picture' });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  fastify.get('/api/v1/chats/:remoteJid/messages', {
    schema: {
      description: 'Get paginated message history for a specific chat',
      tags: ['Chats'],
      params: {
        type: 'object',
        required: ['remoteJid'],
        properties: {
          remoteJid: { type: 'string' }
        }
      },
      querystring: {
        type: 'object',
        required: ['tenant_id', 'device_id'],
        properties: {
          tenant_id: { type: 'string' },
          device_id: { type: 'string' },
          limit: { type: 'number', default: 50 },
          cursor: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { remoteJid } = request.params as any;
    const { tenant_id, device_id, limit, cursor } = request.query as any;

    try {
      const device = await findDeviceByIdentifier(device_id, tenant_id);
      if (!device) return reply.status(404).send({ success: false, error: 'Device not found' });

      // Berlangganan (subscribe) status online pengguna yang sedang dichat (Asynchronous fire & forget)
      try {
        const WAHA_URL = config.wahaUrl;
        const WAHA_API_KEY = config.wahaApiKey;
        axios.post(`${WAHA_URL}/api/${device.id}/presence/${encodeURIComponent(remoteJid)}/subscribe`, {}, {
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Api-Key': WAHA_API_KEY }
        }).catch(e => console.warn(`[WAHA] Failed to subscribe to presence for ${remoteJid}:`, e.message));
      } catch (err) {
        // Abaikan jika error jaringan
      }

      // Ambil histori pesan dari Database Lokal (di-cache oleh webhooks sebelumnya)
      let messages = await findMessagesByChat(tenant_id, device.id, remoteJid, Number(limit) || 50, cursor);

      // --- LAZY LOADING LOGIC ---
      // If DB is empty or only has the latest message for this chat and we are not paginating (no cursor)
      if (messages.length <= 1 && !cursor) {
        try {
          console.log(`[WAHA API Load] Database empty for ${remoteJid}. Fetching history from WAHA API...`);
          const WAHA_URL = config.wahaUrl;
          const WAHA_API_KEY = config.wahaApiKey;
          const fetchLimit = limit ? Number(limit) : 20;
          const wahaUrlParams = `limit=${fetchLimit}&offset=0&downloadMedia=true&sortBy=messageTimestamp&sortOrder=desc&merge=true`;
          const response = await fetch(`${WAHA_URL}/api/${device.id}/chats/${encodeURIComponent(remoteJid)}/messages?${wahaUrlParams}`, {
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Api-Key': WAHA_API_KEY }
          });
          
          const wahaMessages = await response.json() || [];
          for (const msg of wahaMessages) {
            const isFromMe = msg.fromMe || false;
            let initialStatus = 'delivered';
            if (isFromMe) {
              const ackName = msg.ackName;
              const ack = msg.ack;
              if (ackName === 'READ' || ackName === 'PLAYED' || ack === 3 || ack === 4) initialStatus = 'read';
              else if (ackName === 'DELIVERED' || ackName === 'DEVICE' || ack === 2) initialStatus = 'delivered';
              else if (ackName === 'SERVER' || ackName === 'SENT' || ack === 1) initialStatus = 'sent';
              else if (ackName === 'ERROR' || ack === -1) initialStatus = 'failed';
              else initialStatus = 'read';
            }

                const isMediaStr = ['image', 'video', 'audio', 'document', 'sticker'].includes(msg.type) || msg._data?.Info?.Type === 'media' || ['image', 'video', 'audio', 'document', 'sticker'].includes(msg._data?.Info?.MediaType);
                const finalMessageType = (msg.hasMedia || isMediaStr || msg.file?.url || msg.media?.url) ? 'media' : 'text';
                
                let initialMediaUrl = null;
                let initialMediaPath = null;
                if (finalMessageType === 'media') {
                  const b64Thumb = msg._data?.Message?.imageMessage?.JPEGThumbnail || msg._data?.RawMessage?.imageMessage?.JPEGThumbnail || msg._data?.Message?.videoMessage?.jpegThumbnail || msg._data?.RawMessage?.videoMessage?.jpegThumbnail;
                  let directUrl = msg.file?.url || msg.media?.url;
                  
                  if (directUrl && directUrl.includes('?')) {
                    directUrl = directUrl.split('?')[0];
                  }

                  if (b64Thumb) {
                    initialMediaUrl = `data:image/jpeg;base64,${b64Thumb}`;
                    initialMediaPath = directUrl || null;
                  } else {
                    initialMediaUrl = directUrl || null;
                    initialMediaPath = directUrl || null;
                  }
                }

                // Extract quoted message ID
                let replyToMessageId = null;
                if (msg.hasQuotedMsg || msg.quotedMsgId || msg.quoted) {
                  replyToMessageId = msg.quotedMsgId || msg.quoted?.id || msg._data?.quotedStanzaID || msg._data?.Message?.extendedTextMessage?.contextInfo?.stanzaId || null;
                  if (typeof replyToMessageId === 'string' && replyToMessageId.includes('_')) {
                     const parts = replyToMessageId.split('_');
                     replyToMessageId = parts[parts.length - 1];
                  }
                }

                // Simpan ke DB secara atomic (Repository Layer)
                await upsertMessage({
                  tenantId: tenant_id,
                  deviceId: device.id,
                  remoteJid,
                  messageId: msg.id,
                  isFromMe,
                  text: msg.body || '',
                  messageType: finalMessageType as any,
                  mediaUrl: initialMediaUrl,
                  mediaPath: initialMediaPath,
                  replyToMessageId: replyToMessageId,
                  timestamp: new Date(msg.timestamp ? msg.timestamp * 1000 : Date.now()),
                  status: initialStatus as any
                });

            // Trigger background media download if it has media and we don't already have a permanent URL in mediaPath
            if (finalMessageType === 'media' && !initialMediaPath) {
              CloudTasksService.enqueueTask('/api/v1/internal/tasks/download-media', {
                tenantId: tenant_id,
                deviceId: device.id,
                remoteJid,
                messageId: msg.id
              }).catch(e => console.warn(`Failed to enqueue media download for ${msg.id}:`, e));
            }
          }
          
          console.log(`[WAHA API Load] Successfully saved ${wahaMessages.length} messages from WAHA API into local CRM Database.`);

          // Ambil kembali (Refetch) hasil dari Local Database setelah WAHA tersinkronisasi
          messages = await findMessagesByChat(tenant_id, device.id, remoteJid, Number(limit) || 50, cursor);

        } catch (lazyErr: any) {
          console.warn(`[WAHA API Load] Failed to fetch WAHA messages for ${remoteJid}:`, lazyErr.message);
        }
      } else {
        console.log(`[DB Load] Successfully loaded ${messages.length} messages for ${remoteJid} directly from local CRM Database.`);
      }

      // Reverse so oldest is first (typical chat view)
      messages.reverse();

      const signedMessages = await Promise.all(messages.map(async (msg) => {
        if (msg.mediaUrl && msg.mediaUrl.includes('storage.googleapis.com')) {
          try {
            msg.mediaUrl = await getSignedUrl(msg.mediaUrl);
          } catch (e) {
            console.error('[ChatController] Failed to sign mediaUrl:', e);
          }
        }
        return msg;
      }));

      return { success: true, data: signedMessages };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  fastify.post('/api/v1/chats/:remoteJid/read', {
    schema: {
      description: 'Mark chat as read',
      tags: ['Chats'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['remoteJid'],
        properties: {
          remoteJid: { type: 'string' }
        }
      },
      body: {
        type: 'object',
        required: ['device_id'],
        properties: {
          device_id: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { remoteJid } = request.params as any;
    const { device_id } = request.body as any;
    
    try {
      const device = await findDeviceByIdentifier(device_id);
      if (!device) return reply.status(404).send({ success: false, error: 'Device not found' });

      // Pastikan pesan yang belum dibaca (unread) ditandai sebagai telah dibaca di Database kita
      await markMessagesAsRead(device.id, remoteJid);

      // Usaha ringan (Best-effort): Kirim tanda Read Receipt (Centang Biru) ke server WA
      if (device.status !== 'disconnected') {
        const latestMsg = await findLatestUnreadMessage(device.id, remoteJid);
        
        if (latestMsg) {
          try {
            const adapter = AdapterFactory.getAdapter('wa_unofficial');
            if (adapter.markAsRead) {
              await adapter.markAsRead(device.id, remoteJid, latestMsg.messageId);
            }
          } catch (waErr) {
            // Non-fatal: WA read receipt failed, DB is already updated
            console.warn(`[/read] WA read receipt failed for ${remoteJid}:`, waErr);
          }
        }
      }

      return { success: true };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  fastify.post('/api/v1/chats/:remoteJid/presence/subscribe', {
    schema: {
      description: 'Subscribe to presence updates for a chat',
      tags: ['Chats'],
      params: {
        type: 'object',
        required: ['remoteJid'],
        properties: { remoteJid: { type: 'string' } }
      },
      body: {
        type: 'object',
        required: ['tenant_id', 'device_id'],
        properties: {
          tenant_id: { type: 'string' },
          device_id: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { remoteJid } = request.params as any;
    const { tenant_id, device_id } = request.body as any;

    try {
      const device = await findDeviceByIdentifier(device_id, tenant_id);
      if (!device) return reply.status(404).send({ error: 'Device not found' });

      const WAHA_URL = config.wahaUrl;
      const WAHA_API_KEY = config.wahaApiKey;
      
      await axios.post(`${WAHA_URL}/api/${device.id}/presence/${encodeURIComponent(remoteJid)}/subscribe`, {}, {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Api-Key': WAHA_API_KEY }
      });
      return { success: true };
    } catch (err: any) {
      console.warn(`[WAHA] Presence subscribe failed for ${remoteJid}:`, err.message);
      return { success: false, error: err.message };
    }
  });

  fastify.post('/api/v1/chats/:remoteJid/messages/:messageId/reaction', {
    schema: {
      description: 'React to a message',
      tags: ['Chats'],
      params: {
        type: 'object',
        required: ['remoteJid', 'messageId'],
        properties: {
          remoteJid: { type: 'string' },
          messageId: { type: 'string' }
        }
      },
      body: {
        type: 'object',
        required: ['tenant_id', 'device_id', 'emoji'],
        properties: {
          tenant_id: { type: 'string' },
          device_id: { type: 'string' },
          emoji: { type: 'string', description: 'Emoji character, or empty string to remove' }
        }
      }
    }
  }, async (request, reply) => {
    const { remoteJid, messageId } = request.params as any;
    const { tenant_id, device_id, emoji } = request.body as any;

    const device = await findDeviceByIdentifier(device_id, tenant_id);
    if (!device) return reply.status(404).send({ error: 'Device not found' });

    const toJid = normalizeJid(remoteJid);

    // Enqueue message
    await CloudTasksService.enqueueTask('/api/v1/internal/tasks/send-reaction', {
      deviceId: device.id,
      channelType: device.channelType,
      payload: { to: toJid, messageId, emoji }
    });

    return { success: true };
  });

  fastify.get('/api/v1/chats/:remoteJid/profile-picture', {
    schema: {
      description: 'Get profile picture for a chat',
      tags: ['Chats'],
      params: {
        type: 'object',
        required: ['remoteJid'],
        properties: {
          remoteJid: { type: 'string' }
        }
      },
      querystring: {
        type: 'object',
        required: ['tenant_id', 'device_id'],
        properties: {
          tenant_id: { type: 'string' },
          device_id: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { remoteJid } = request.params as any;
    const { tenant_id, device_id } = request.query as any;

    try {
      const device = await findDeviceByIdentifier(device_id, tenant_id);
      if (!device) return reply.status(404).send({ success: false, error: 'Device not found' });

      if (device.status === 'disconnected') {
        return reply.status(400).send({ success: false, error: 'Device is disconnected' });
      }

      const adapter = AdapterFactory.getAdapter('wa_unofficial') as any;
      if (adapter.getProfilePicture) {
        const url = await adapter.getProfilePicture(device.id, remoteJid);
        return { success: true, url };
      }
      return { success: true, url: null };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  fastify.get('/api/v1/chats/media', {
    schema: {
      description: 'Get a fresh signed URL for media',
      tags: ['Chats'],
      querystring: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { path } = request.query as any;
      if (!path) return reply.status(400).send({ success: false, error: 'Missing path' });
      const signedUrl = await getSignedUrl(path);
      return { success: true, url: signedUrl };
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // Get Contact Profile (tags, notes, email)
  fastify.get('/api/v1/contacts/:remoteJid/profile', async (request, reply) => {
    try {
      const { remoteJid } = request.params as any;
      const gcsPath = `contacts/${remoteJid}/profile.json`;
      const profileData = await readJson(gcsPath) || {};
      
      // Muat informasi profil lokal (dari file json dan db)
      const contact = await findContactByRemoteJidOnly(remoteJid);

      return {
        success: true,
        data: {
          remoteJid,
          pushName: contact?.pushName || profileData.pushName || null,
          profilePic: contact?.profilePic || profileData.profilePic || null,
          email: profileData.email || '',
          notes: profileData.notes || '',
          tags: profileData.tags || ['Prospect']
        }
      };
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // Update Contact Profile (tags, notes, email)
  fastify.put('/api/v1/contacts/:remoteJid/profile', async (request, reply) => {
    try {
      const { remoteJid } = request.params as any;
      const { email, notes, tags } = request.body as any;

      const gcsPath = `contacts/${remoteJid}/profile.json`;
      const existing = await readJson(gcsPath) || {};
      
      const updated = {
        ...existing,
        email: email !== undefined ? email : existing.email,
        notes: notes !== undefined ? notes : existing.notes,
        tags: Array.isArray(tags) ? tags : (existing.tags || []),
        updatedAt: new Date().toISOString()
      };

      await uploadJson(updated, gcsPath);

      return { success: true, data: updated };
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // Get Chat Media Gallery
  fastify.get('/api/v1/chats/:remoteJid/media-gallery', async (request, reply) => {
    try {
      const { remoteJid } = request.params as any;
      // Muat kumpulan galeri gambar dari riwayat chat
      const mediaMessages = await getMediaGalleryByChat(remoteJid, 100);

      return {
        success: true,
        data: mediaMessages
      };
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}

function formatPhoneNumber(remoteJid: string): string {
  if (!remoteJid || remoteJid.endsWith('@g.us')) return remoteJid;
  const digits = remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!digits) return remoteJid;

  if (digits.startsWith('62')) {
    const rest = digits.substring(2);
    if (rest.length >= 8) {
      return `+62 ${rest.substring(0, 3)}-${rest.substring(3, 7)}-${rest.substring(7)}`;
    }
    return `+62 ${rest}`;
  }

  if (digits.startsWith('86')) {
    const rest = digits.substring(2);
    if (rest.length >= 10) {
      return `+86 ${rest.substring(0, 3)} ${rest.substring(3, 7)} ${rest.substring(7)}`;
    }
    return `+86 ${rest}`;
  }

  return `+${digits}`;
}

function formatDisplayName(pushName: string | null | undefined, remoteJid: string): string {
  if (pushName && pushName.trim() && !pushName.includes('@c.us') && !pushName.includes('@s.whatsapp.net') && !pushName.includes('@g.us')) {
    return pushName.trim();
  }

  if (remoteJid.endsWith('@g.us')) {
    const rawId = remoteJid.split('@')[0];
    return `Group (${rawId.substring(0, 8)}...)`;
  }

  return formatPhoneNumber(remoteJid);
}
