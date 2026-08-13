import { findMessageByWahaId, updateMessageData } from '../../repositories/chatMessageRepository';
import { io } from '../../server';
import { normalizeJid } from '../../utils/phoneUtils';

/**
 * Fungsi untuk menangani Event Reaksi (message.reaction) dari WAHA.
 * Ini terpanggil setiap kali seorang pengguna menambahkan atau mencabut reaksi emoji (seperti ❤️, 👍, 😂) dari sebuah pesan.
 */
export async function handleMessageReaction(payload: any, device: any, deviceId: string) {
  const reaction = payload.payload;
  
  // Jika tidak ada data payload atau ID pesan yang ditargetkan tidak valid, abaikan.
  if (!reaction || !reaction.msgId) return;

  // Mendapatkan nomor JID tempat reaksi dikirim (apakah ini grup, atau nomor individu)
  let rawRemoteJid = reaction.chatId || reaction.from;
  if (!rawRemoteJid) return;
  const remoteJid = normalizeJid(rawRemoteJid);

  // Ambil ID pesan utama yang sedang diberi reaksi emoji
  // WAHA biasanya memberikan format string terserial, contoh: "true_628xxx_ABCD"
  let targetMessageId = typeof reaction.msgId === 'string' ? reaction.msgId : reaction.msgId._serialized;
  
  // Pisahkan string berdasarkan '_' (underscore) untuk mengambil ID pendek (ABCD)
  if (typeof targetMessageId === 'string' && targetMessageId.includes('_')) {
      const parts = targetMessageId.split('_');
      targetMessageId = parts[parts.length - 1]; // Mengambil bagian paling belakang dari array string.
  }

  const emoji = reaction.reaction;
  
  // Cari tahu siapa kontak (nomor) yang memberikan reaksi ini
  const sender = reaction.senderId || reaction.sender; 

  if (targetMessageId) {
    // Cari pesan aslinya (pesan yang diberi reaksi) di database kita
    const targetMsg = await findMessageByWahaId(deviceId, remoteJid, targetMessageId);

    // Jika pesan ditemukan, perbarui (update) reaksi emoji di kolom database "reactions" (format JSON)
    if (targetMsg) {
      let currentReactions: any = targetMsg.reactions || {};
      if (typeof currentReactions !== 'object') currentReactions = {};
      
      // Jika string emoji kosong, ini artinya si pemberi reaksi MENGHAPUS / MENCABUT reaksinya (remove reaction)
      if (!emoji) {
        delete currentReactions[sender]; // Hapus objek reaksi berdasarkan nomor sender
      } else {
        // Tambahkan / Timpa emoji baru yang diberikan oleh kontak tersebut
        currentReactions[sender] = emoji; 
      }

      // Simpan kembali json reactions yang sudah diubah (di-update) ke dalam database Postgres
      await updateMessageData(targetMsg.id, { reactions: currentReactions });

      // Siarkan via Socket.io agar ikon emoji seketika muncul atau hilang di layar Frontend.
      io.to(`tenant_${device.tenantId}`).emit('message_reaction', {
        device_id: deviceId,
        remoteJid,
        messageId: targetMessageId,
        reactions: currentReactions
      });
    }
  }
}
