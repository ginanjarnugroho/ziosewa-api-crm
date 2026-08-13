import { FastifyInstance } from 'fastify';
import { getDeviceById } from '../repositories/deviceRepository';
import { getRecentDebugMessages } from '../repositories/chatMessageRepository';
import { handleSessionStatus } from '../services/waha/sessionService';
import { handleMessageAny } from '../services/waha/messageService';
import { handleMessageReaction } from '../services/waha/reactionService';
import { handleMessageAck } from '../services/waha/ackService';
import { handlePresenceUpdate } from '../services/waha/presenceService';

/**
 * Pengontrol Webhook WAHA (WhatsApp HTTP API)
 * File ini bertugas sebagai "pintu masuk utama" (Router) untuk semua event yang dikirim oleh WAHA.
 * Agar kode lebih rapi dan mudah dirawat, file ini tidak lagi memproses logika yang rumit secara langsung,
 * melainkan meneruskannya ke layanan (service) spesifik berdasarkan jenis event-nya.
 */
export default async function wahaWebhookController(fastify: FastifyInstance) {
  fastify.post('/api/v1/webhooks/waha', async (request, reply) => {
    const payload: any = request.body;
    
    // PENTING: Segera kembalikan status 200 OK ke WAHA.
    // Jika kita tidak merespon dengan cepat, WAHA akan menganggap webhook gagal dan terputus (Timeout/Context Canceled).
    reply.send({ ok: true });

    // Semua proses yang berat dilakukan secara asynchronous di latar belakang 
    // agar tidak memblokir respon ke WAHA di atas.
    (async () => {
      try {
        // Jika payload kosong atau tidak memiliki ID sesi, abaikan.
        if (!payload || !payload.session) return;

        const deviceId = payload.session;
        
        // Cari perangkat (device) di database untuk memastikan perangkat tersebut valid dan terdaftar.
        const device = await getDeviceById(deviceId);
        if (!device) return;

        // Ambil jenis event yang dikirimkan oleh WAHA (misalnya: pesan masuk, status koneksi berubah, dll)
        const event = payload.event;

        // Routing (Penyaluran) Event:
        // Cek tipe event dan arahkan ke layanan yang bertugas menanganinya.
        switch (event) {
          case 'session.status':
            // Menangani status sesi seperti saat muncul QR Code, terhubung, atau gagal.
            await handleSessionStatus(payload, device, deviceId);
            break;
            
          case 'message':
          case 'message.any':
            // Menangani semua pesan masuk dan keluar (teks, gambar, dll), termasuk deduplikasi.
            await handleMessageAny(payload, device, deviceId);
            break;
            
          case 'message.reaction':
            // Menangani saat pengguna memberikan reaksi emoji pada pesan tertentu.
            await handleMessageReaction(payload, device, deviceId);
            break;
            
          case 'message.ack':
            // Menangani status pesan (centang satu = server, centang dua = delivered, biru = read).
            await handleMessageAck(payload, device, deviceId);
            break;
            
          case 'presence.update':
            // Menangani saat ada notifikasi pengguna lain sedang "mengetik..." atau "merekam suara...".
            await handlePresenceUpdate(payload, device, deviceId);
            break;
            
          default:
            // Jika ada event lain yang belum kita dukung, abaikan saja agar tidak terjadi error.
            break;
        }

      } catch (err: any) {
        // Tangkap dan catat error jika ada proses latar belakang yang bermasalah.
        console.error('WAHA Async Webhook error:', err.message);
      }
    })();
  });

  // Endpoint khusus untuk debugging/pengecekan pesan secara manual
  fastify.get('/api/v1/debug/messages', async (request, reply) => {
    const messages = await getRecentDebugMessages(10);
    return reply.send(messages);
  });
}
