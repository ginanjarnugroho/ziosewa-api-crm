import { findMessageByShortId, updateMessageData } from '../../repositories/chatMessageRepository';
import { io } from '../../server';

/**
 * Fungsi untuk memproses status penerimaan dan keterbacaan pesan (Event message.ack).
 * Event ini sangat krusial karena mengatur perubahan centang satu -> centang dua -> centang biru.
 */
export async function handleMessageAck(payload: any, device: any, deviceId: string) {
  const msgAck = payload.payload;
  if (!msgAck) return;

  // Baca tipe acknowledgment (ACK) dari payload.
  let ackName = msgAck.ackName;
  
  // Jika WAHA versi jadul hanya memberikan kode angka (ack: 1, 2, 3), 
  // kita konversikan angka tersebut menjadi nama status yang bermakna.
  if (!ackName && typeof msgAck.ack === 'number') {
     if (msgAck.ack === 1) ackName = 'SERVER'; // Centang 1
     else if (msgAck.ack === 2) ackName = 'DEVICE'; // Centang 2
     else if (msgAck.ack === 3) ackName = 'READ'; // Centang Biru
     else if (msgAck.ack === 4) ackName = 'PLAYED'; // Pesan suara didengarkan (Biru)
     else if (msgAck.ack === -1) ackName = 'ERROR'; // Gagal Kirim
  }

  // Petakan nilai dari WAHA (ackName) menjadi nilai status baku database ('delivered', 'read', 'failed', 'sent')
  let newStatus = 'sent';
  if (ackName === 'DELIVERED' || ackName === 'DEVICE') newStatus = 'delivered'; // Tersampaikan ke HP target (Centang 2 abu)
  else if (ackName === 'READ' || ackName === 'PLAYED') newStatus = 'read'; // Dibaca oleh penerima (Centang biru)
  else if (ackName === 'ERROR') newStatus = 'failed'; // Gagal kirim (Tanda Merah)
  else if (ackName === 'SERVER') newStatus = 'sent'; // Terkirim ke server WhatsApp (Centang 1 abu)

  const rawId = typeof msgAck.id === 'string' ? msgAck.id : msgAck.id?._serialized;
  
  // Siapkan penampung (Set) unik untuk mengumpulkan semua ID pesan.
  // WAHA sering mem-batch (menggabungkan) laporan ACK dari beberapa pesan sekaligus ke dalam satu Webhook (bulk).
  const targetShortIds = new Set<string>();
  
  // Fungsi kecil untuk membersihkan (extract) ID string menjadi ID pendek yang tersimpan di database kita.
  const addId = (idVal: string | undefined | null) => {
      if (!idVal || typeof idVal !== 'string') return;
      if (idVal.includes('_')) {
          const parts = idVal.split('_');
          targetShortIds.add(parts[parts.length - 1]);
      } else {
          targetShortIds.add(idVal);
      }
  };

  // Masukkan berbagai macam probabilitas posisi ID yang dikirim oleh WAHA.
  addId(msgAck.id?._serialized);
  addId(msgAck.id?.id);
  if (typeof msgAck.id === 'string') addId(msgAck.id);
  
  // Jika WAHA mengirim Multiple IDs (Batch / Bulk Acks), ekstrak satu-per-satu.
  if (msgAck._data?.MessageIDs && Array.isArray(msgAck._data.MessageIDs)) {
      msgAck._data.MessageIDs.forEach((id: string) => addId(id));
  }

  console.log(`[WAHA] Received message.ack for IDs: ${Array.from(targetShortIds).join(', ')} / rawId:${rawId} with status ${ackName}`);

  // Loop dan Update setiap ID pesan di dalam database
  for (const shortId of targetShortIds) {
      // Cari pesan berdasarkan kueri tidak sensitif huruf besar/kecil (Insensitive).
      // Meminimalisir kegagalan pencarian akibat ketidaksesuaian uppercase.
      let chatMsg = await findMessageByShortId(shortId);

      if (chatMsg) {
         // Pesan ketemu! Segera perbarui statusnya ('delivered' / 'read') di database
         await updateMessageData(chatMsg.id, { status: newStatus as any });

         console.log(`[WAHA SUCCESS] Updated message ${chatMsg.id} (${chatMsg.messageId}) status to '${newStatus}' in DB`);

         // Beritahu layar antarmuka pengguna (Frontend) via Socket agar centang abu-abu langsung berubah menjadi centang biru
         io.to(`tenant_${device.tenantId}`).emit('message_status_update', {
           device_id: deviceId,
           remoteJid: chatMsg.remoteJid,
           messageId: chatMsg.messageId, // Kirim WAHA ID
           status: newStatus // Kirim status baru
         });
      } else {
         // Kasus Edge (sangat jarang terjadi): 
         // WAHA mengirim centang biru SEBELUM pesan itu tersimpan oleh Frontend/Worker.
         console.log(`[WAHA WARN] Message shortId:${shortId} not found in DB.`);
      }
  }
}
