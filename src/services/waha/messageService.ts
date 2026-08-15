import { upsertContact } from '../../repositories/contactRepository';
import { findMessageByWahaId, findRecentOutboundMessage, updateMessageData, upsertMessage } from '../../repositories/chatMessageRepository';
import { io } from '../../server';
import axios from 'axios';
import { getExtFromUrl, uploadFromUrl, uploadBuffer } from '../../services/gcsService';
import { config } from '../../config/env';
import { normalizeJid } from '../../utils/phoneUtils';
import fs from 'fs';

// Cache sederhana untuk menyimpan ID pesan yang baru saja diproses 
// agar tidak terjadi duplikasi pengerjaan saat webhook mengirimkan pesan yang sama dua kali.
const processedMsgCache = new Set<string>();

/**
 * Fungsi untuk mendeteksi pesan duplikat berdasarkan ID.
 * ID pesan disimpan di memori selama 60 detik.
 */
export function isDuplicateWebhookMsg(msgId: string): boolean {
  if (!msgId) return false;
  if (processedMsgCache.has(msgId)) return true;
  processedMsgCache.add(msgId);
  setTimeout(() => processedMsgCache.delete(msgId), 60000);
  return false;
}

/**
 * Fungsi utama untuk menangani semua jenis pesan masuk maupun pesan keluar.
 * Event WAHA yang ditangani: 'message' dan 'message.any'
 */
export async function handleMessageAny(payload: any, device: any, deviceId: string) {
  const msg = payload.payload;
  if (!msg || !msg.id) return;

  // Abaikan pesan tipe 'reaction' (reaksi emoji) atau 'revoked' (pesan ditarik).
  // Reaksi akan ditangani di reactionService.ts
  if (msg.type === 'reaction' || msg.type === 'revoked') {
    return;
  }

  // Cek apakah pesan ini sudah pernah diproses di webhook (menghindari duplikasi insert ke database)
  if (isDuplicateWebhookMsg(msg.id)) {
     console.log(`[WAHA Webhook] Skipped duplicate event (message.any) for msgId: ${msg.id}`);
     return;
  }


  const isFromMe = msg.fromMe || false;

  // WhatsApp terkadang menggunakan akhiran @lid (masking nomor) pada kontak bisnis (WhatsApp Business).
  // Bagian ini mencari nomor WhatsApp aslinya (SenderAlt) jika ada, asalkan bukan grup.
  let rawRemoteJid = msg.chatId;
  if (!rawRemoteJid) {
    rawRemoteJid = isFromMe ? msg.to : msg.from;
  }
  const isGroup = rawRemoteJid?.endsWith('@g.us') || (msg.from && msg.from.endsWith('@g.us')) || (msg.chatId && msg.chatId.endsWith('@g.us')) || msg._data?.Info?.IsGroup || false;
  
  if (!isGroup && rawRemoteJid?.includes('@lid')) {
     const alt = msg._data?.Info?.SenderAlt || msg._data?.Info?.ReceiverAlt || msg._data?.SenderAlt || msg.senderAlt;
     if (alt) {
        rawRemoteJid = alt; // Gunakan nomor asli pengganti LID
     }
  }

  // Lakukan normalisasi nomor WhatsApp (misal, hapus spasi, pastikan menggunakan format internasional)
  const remoteJid = normalizeJid(rawRemoteJid);
  const text = msg.body || '';

  // Penentuan Status Awal
  // Jika ini adalah pesan keluar (dari kita), kita cek status tanda terkirimnya.
  let initialStatus = 'delivered';
  if (isFromMe) {
    const ackName = msg.ackName;
    const ack = msg.ack;
    
    // ack: 1 (Terkirim ke Server WhatsApp), 2 (Masuk ke Perangkat Penerima), 3/4 (Sudah Dibaca/Diputar)
    if (ackName === 'READ' || ackName === 'PLAYED' || ack === 3 || ack === 4) initialStatus = 'read';
    else if (ackName === 'DELIVERED' || ackName === 'DEVICE' || ack === 2) initialStatus = 'delivered';
    else if (ackName === 'SERVER' || ackName === 'SENT' || ack === 1) initialStatus = 'sent';
    else if (ackName === 'ERROR' || ack === -1) initialStatus = 'failed';
    else initialStatus = 'read'; // Jika pesan tersebut hasil sinkronisasi histori masa lalu, anggap sudah dibaca
  }

  /**
   * --- 1. PROSES PENYIMPANAN KONTAK BUKU ALAMAT ---
   */
  if (!isGroup) {
    // KONDISI: Percakapan Pribadi (Bukan Grup)
    // HANYA simpan nama profil jika pesan ini MASUK (isFromMe = false).
    // Jika pesan ini KELUAR, pushName yang dikirim WA adalah nama kita sendiri, jadi jangan menimpa data kontak pelanggan.
    if (!isFromMe) {
      const pushName = msg.pushName || msg._data?.notifyName || msg._data?.Info?.PushName;
      if (pushName && !pushName.includes('@c.us') && !pushName.includes('@g.us')) {
         await upsertContact(deviceId, remoteJid, device.tenantId, pushName);
      }
    }
  } else {
    // KONDISI: Percakapan Grup
    // 1. Simpan nama grup, jangan pernah gunakan nama profil peserta untuk menamai grup!
    const groupName = msg._data?.chat?.name || msg._data?.Info?.Subject || msg._data?.groupSubject || msg.chat?.name;
    if (groupName) {
       await upsertContact(deviceId, remoteJid, device.tenantId, groupName);
    }

    // 2. Simpan juga informasi kontak orang (peserta) yang mengirim pesan di dalam grup tersebut.
    const participantJid = msg.participant || msg.author || msg._data?.author || msg._data?.participant;
    const participantPushName = msg.pushName || msg._data?.notifyName || msg._data?.Info?.PushName;
    if (participantJid && participantPushName && !participantJid.endsWith('@g.us')) {
       await upsertContact(deviceId, participantJid, device.tenantId, participantPushName);
    }
  }

  /**
   * --- 2. PROSES PENYIMPANAN MEDIA (GAMBAR/VIDEO/DOKUMEN) ---
   */
  // Deteksi apakah pesan ini mengandung tipe file (media)
  const isMediaStr = ['image', 'video', 'audio', 'document', 'sticker'].includes(msg.type) || msg._data?.Info?.Type === 'media' || ['image', 'video', 'audio', 'document', 'sticker'].includes(msg._data?.Info?.MediaType);
  const isMediaMsg = msg.hasMedia || isMediaStr || msg.file?.url || msg.media?.url || msg.mediaUrl;
  
  let initialMediaUrl: string | null = null;
  let initialMediaPath: string | null = null;
  let finalMessageType = isMediaMsg ? 'media' : 'text';

  if (isMediaMsg) {
    // Ambil data thumbnail berformat Base64 jika tersedia (terutama untuk gambar dan video)
    const b64Thumb = msg._data?.Message?.imageMessage?.JPEGThumbnail || msg._data?.RawMessage?.imageMessage?.JPEGThumbnail || msg._data?.Message?.videoMessage?.jpegThumbnail || msg._data?.RawMessage?.videoMessage?.jpegThumbnail || msg.media?.thumbnail;
    let directUrl = msg.file?.url || msg.media?.url || msg.mediaUrl || msg._data?.mediaUrl;
    
    // Bersihkan URL dari argumen query tak terpakai
    if (directUrl && directUrl.includes('?')) {
      directUrl = directUrl.split('?')[0];
    }

    if (b64Thumb && !b64Thumb.startsWith('data:')) {
      initialMediaUrl = `data:image/jpeg;base64,${b64Thumb}`; // Format Base64 agar langsung bisa dirender HTML
      initialMediaPath = directUrl || null;
    } else if (b64Thumb && b64Thumb.startsWith('data:')) {
      initialMediaUrl = b64Thumb;
      initialMediaPath = directUrl || null;
    } else {
      initialMediaUrl = directUrl || null;
      initialMediaPath = directUrl || null;
    }

    // BACKUP/FALLBACK:
    // Jika WhatsApp tidak mengirim URL unduhan atau Base64, maka perintahkan WAHA API untuk 
    // mengunduh (download) media tersebut secara paksa dan kita akan simpan hasil unduhannya ke Google Cloud (GCS).
    if (!initialMediaPath && !initialMediaUrl) {
      const wahaUrl = config.wahaUrl;
      const wahaApiKey = config.wahaApiKey;
      const downloadUrl = `${wahaUrl}/api/${deviceId}/messages/${msg.id}/download`;

      try {
        const response = await axios.get(downloadUrl, {
          headers: {
            'X-Api-Key': wahaApiKey,
            'Accept': 'application/json'
          },
          responseType: 'arraybuffer' // Tarik dalam format raw byte
        });

        let buffer: Buffer;
        let mimetype = 'application/octet-stream';
        let filename = `${msg.id}.bin`;

        if ((response.headers['content-type'] as string)?.includes('application/json')) {
           // WAHA mengirim respon JSON yang di dalamnya terdapat string media Base64
           const data = JSON.parse(response.data.toString('utf8'));
           buffer = Buffer.from(data.data || data.base64 || '', 'base64');
           mimetype = data.mimetype;
           filename = data.filename || `${msg.id}`;
        } else {
           // WAHA mengirim respon berupa file raw langsung
           buffer = Buffer.from(response.data);
           mimetype = (response.headers['content-type'] as string) || mimetype;
           const mimeToExt: any = {
             'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
             'video/mp4': '.mp4', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg',
             'application/pdf': '.pdf'
           };
           filename = `${msg.id}${mimeToExt[mimetype] || '.bin'}`;
        }

        // Upload ke Google Cloud Storage (GCS)
        const gcsPath = `inbound-media/${deviceId}/${filename}`;
        const downloadedGcsUrl = await uploadBuffer(buffer, gcsPath, mimetype);
        initialMediaPath = downloadedGcsUrl; // Simpan URL publik dari GCS
        
        if (!initialMediaUrl) initialMediaUrl = downloadedGcsUrl;
      } catch (mediaErr: any) {
        console.warn(`[WAHA WARN] Failed to download inbound media. URL: ${downloadUrl}`);
        console.warn(`[WAHA WARN] Error:`, mediaErr.message);
      }
    }
  }

  /**
   * --- 3. PROSES PESAN BALASAN (REPLY) ---
   */
  let replyToMessageId = null;
  if (msg.hasQuotedMsg || msg.quotedMsgId || msg.quoted) {
    // Ambil ID dari pesan yang sedang di-reply/dikutip
    replyToMessageId = msg.quotedMsgId || msg.quoted?.id || msg._data?.quotedStanzaID || msg._data?.Message?.extendedTextMessage?.contextInfo?.stanzaId || null;
    
    // WAHA terkadang mengirim ID berserial lengkap (seperti true_6281xxxxxx_abcd123). Kita hanya butuh short ID (abcd123)-nya saja.
    if (typeof replyToMessageId === 'string' && replyToMessageId.includes('_')) {
       const parts = replyToMessageId.split('_');
       replyToMessageId = parts[parts.length - 1];
    }
  }

  /**
   * --- 4. PENYELARASAN DEDUPLIKASI UI DAN BACKEND (PENTING!) ---
   */
  // Periksa apakah pesan dengan ID WAHA ini sudah ada di dalam database
  let existingMsg = await findMessageByWahaId(deviceId, remoteJid, msg.id);

  // Jika pesan ini belum ada di DB, DAN pesannya adalah milik kita (dikirim lewat frontend web),
  // frontend akan membuat pesan sementara berstatus "pending" (dengan ID seperti 'msg_12345').
  // Di blok ini, kita menyelaraskan (mengganti) ID pesan 'msg_12345' tersebut menjadi ID WAHA asli agar frontend tahu bahwa pesan tersebut telah berhasil terkirim.
  if (!existingMsg && isFromMe) {
    const recentOutbound = await findRecentOutboundMessage(deviceId, remoteJid, text);

    if (recentOutbound) {
      try {
        // Update pesan sementara di database menggunakan ID Asli WAHA beserta stempel waktu yang sesuai.
        const updatedMsg = await updateMessageData(recentOutbound.id, {
          messageId: msg.id, 
          status: initialStatus as any,
          timestamp: new Date(msg.timestamp ? msg.timestamp * 1000 : Date.now())
        });
        
        // Beritahu frontend via Socket bahwa ID pesan tersebut baru saja diperbarui.
        io.to(`tenant_${device.tenantId}`).emit('chat_message_updated', {
          device_id: deviceId,
          remote_jid: remoteJid,
          message: {
            id: updatedMsg.id,
            messageId: updatedMsg.messageId,
            text: updatedMsg.text,
            status: updatedMsg.status,
            timestamp: updatedMsg.timestamp
          }
        });
      } catch (err: any) {
        if (err.code === 'P2002') {
          console.log(`[WAHA Webhook] Ignored duplicate update for msgId: ${msg.id}`);
        } else {
          console.error('[WAHA Webhook] Error updating outbound message:', err);
        }
      }
      return; // Berhenti memproses, karena pesan ini sebenarnya sudah ditangani oleh Frontend Optimistic UI.
    }
  }

  /**
   * --- 5. SIMPAN KE DATABASE SEBAGAI PESAN BARU ---
   */
  let chatMsg;
  try {
    chatMsg = await upsertMessage({
      tenantId: device.tenantId,
      deviceId,
      remoteJid,
      messageId: msg.id,
      isFromMe,
      text,
      messageType: finalMessageType as any,
      mediaUrl: initialMediaUrl,
      mediaPath: initialMediaPath,
      replyToMessageId: replyToMessageId,
      timestamp: new Date(msg.timestamp ? msg.timestamp * 1000 : Date.now()),
      status: initialStatus as any
    });
  } catch (e: any) {
    if (e.code === 'P2002') {
       console.log(`[Webhook] Message ${msg.id} already inserted concurrently. Ignoring duplicate.`);
       return;
    }
    throw e;
  }

  /**
   * --- 6. SIARKAN KEPADA FRONTEND ---
   */
  // Jika ini adalah pesan yang benar-benar baru, beritahu UI (Frontend) agar memunculkan bubble chat baru!
  if (!existingMsg) {
    io.to(`tenant_${device.tenantId}`).emit('chat_message', {
       device_id: deviceId,
       remoteJid,
       message: chatMsg
    });
  }
}
