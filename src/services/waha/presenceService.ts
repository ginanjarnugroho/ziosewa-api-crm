import { io } from '../../server';
import { normalizeJid } from '../../utils/phoneUtils';

/**
 * Fungsi untuk memproses status kehadiran pengguna lain / Presence (Event presence.update).
 * Fitur ini berfungsi untuk menampilkan status "Si A sedang mengetik..." atau "Si B sedang merekam suara...".
 */
export async function handlePresenceUpdate(payload: any, device: any, deviceId: string) {
  const presencePayload = payload.payload;
  if (!presencePayload) return;

  // Log payload untuk kebutuhan pemantauan jika ada bug struktur WAHA
  console.log('[WAHA PRESENCE DEBUG]', JSON.stringify(presencePayload));

  let rawRemoteJid = presencePayload.chatId || presencePayload.id;
  if (!rawRemoteJid) return;
  
  // Normalisasi JID untuk memastikan formatnya sesuai (menghilangkan karakter aneh atau spasi)
  const remoteJid = normalizeJid(rawRemoteJid);
  
  // Ambil nilai 'presence' aktual dari berbagai macam format payload WAHA.
  let presence = 'available'; // Default status adalah 'available' (Online).
  
  if (presencePayload.presences && Array.isArray(presencePayload.presences) && presencePayload.presences.length > 0) {
    // Pada Grup atau versi WAHA yang baru, status terdapat di dalam array presences
    presence = presencePayload.presences[0].lastKnownPresence || presencePayload.presences[0].lastKnownPresence;
  } else if (presencePayload.presence) {
    // Sebagai alternatif/fallback (pada WAHA versi lama), ambil dari properti presence biasa
    presence = presencePayload.presence; 
  }

  // Tentukan tindakan/status yang ingin dimunculkan ke frontend.
  // Hanya teruskan status 'typing' atau 'recording'
  if (presence === 'composing' || presence === 'typing') {
    presence = 'typing'; // Sedang mengetik teks
  } else if (presence === 'recording') {
    presence = 'recording'; // Sedang merekam voice note
  } else {
    presence = 'available'; // Status biasa (hanya online saja, tapi tidak melakukan tindakan)
  }

  // Siarkan pembaruan aktivitas pengguna (sedang mengetik / merekam) ke Frontend Web
  // agar muncul tulisan "typing..." di atas layar chat.
  io.to(`tenant_${device.tenantId}`).emit('presence_update', {
    device_id: deviceId,
    remoteJid,
    presence 
  });
}
