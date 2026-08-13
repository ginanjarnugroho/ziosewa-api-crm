import { updateDeviceStatus } from '../../repositories/deviceRepository';
import { io } from '../../server';
import axios from 'axios';
import { config } from '../../config/env';
import QRCode from 'qrcode';
import { uploadJson } from '../../services/gcsService';

/**
 * Fungsi untuk menangani perubahan status sesi WhatsApp (session.status)
 * Menangani 3 kondisi utama:
 * 1. WORKING - Saat WhatsApp sudah berhasil login dan terkoneksi.
 * 2. SCAN_QR_CODE - Saat WhatsApp meminta pengguna untuk melakukan scan barcode (belum login).
 * 3. FAILED - Saat koneksi WhatsApp terputus atau gagal login.
 */
export async function handleSessionStatus(payload: any, device: any, deviceId: string) {
  const status = payload.payload?.status; // Contoh nilai: SCAN_QR_CODE, WORKING, FAILED

  if (status === 'WORKING') {
     // WhatsApp terhubung.
     // Perbarui status device di database menjadi 'connected'
     await updateDeviceStatus(deviceId, 'connected', 'CONNECTED');
     
     // Beritahu frontend via WebSockets agar UI berubah (menghilangkan tampilan QR Code)
     io.to(`tenant_${device.tenantId}`).emit('connection_update', { device_id: deviceId, status: 'connected' });

     // Simpan log status ke Google Cloud Storage (GCS) untuk keperluan pelacakan masalah/log
     uploadJson(
       { deviceId, status: 'WORKING', tenantId: device.tenantId, timestamp: new Date().toISOString() },
       `sessions/${deviceId}/status_${Date.now()}.json`
     ).catch((e) => console.warn('[GCS] Failed to save session log:', e.message));

  } else if (status === 'SCAN_QR_CODE') {
     // WhatsApp membutuhkan QR Code untuk login.
     const WAHA_URL = config.wahaUrl;
     const WAHA_API_KEY = config.wahaApiKey;
     
     // Beri jeda 1,5 detik agar WAHA sempat meng-generate gambar QR Code dengan sempurna.
     setTimeout(async () => {
       try {
         // Ambil raw string QR dari endpoint otentikasi WAHA
         const res = await axios.get(`${WAHA_URL}/api/${deviceId}/auth/qr?format=raw`, {
           headers: { 'X-Api-Key': WAHA_API_KEY }
         });
         const qrRaw = typeof res.data === 'string' ? res.data : (res.data?.value || res.data?.qr);
         
         if (qrRaw) {
           // Konversi string mentah QR menjadi gambar dalam format Base64 (bisa dirender di frontend HTML)
           const qrBase64 = await QRCode.toDataURL(qrRaw);
           
           // Kirim kode QR ke frontend melalui WebSocket agar pengguna bisa scan
           io.to(`tenant_${device.tenantId}`).emit('qr_update', { device_id: deviceId, qr: qrBase64 });

           // Simpan history/log status QR ke GCS
           uploadJson(
             { deviceId, status: 'SCAN_QR_CODE', tenantId: device.tenantId, timestamp: new Date().toISOString() },
             `sessions/${deviceId}/status_${Date.now()}.json`
           ).catch((e) => console.warn('[GCS] Failed to save QR session log:', e.message));
         }
       } catch (err: any) {
         console.error('[WAHA] Failed to fetch/emit QR:', err.message);
       }
     }, 1500);
     
  } else if (status === 'FAILED') {
     // Koneksi WhatsApp terputus atau sesi gagal.
     // Perbarui status database menjadi 'disconnected'
     await updateDeviceStatus(deviceId, 'disconnected', 'DISCONNECTED');
     
     // Beritahu frontend via WebSocket bahwa statusnya terputus
     io.to(`tenant_${device.tenantId}`).emit('connection_update', { device_id: deviceId, status: 'disconnected' });

     // Simpan log kegagalan ke GCS
     uploadJson(
       { deviceId, status: 'FAILED', tenantId: device.tenantId, timestamp: new Date().toISOString() },
       `sessions/${deviceId}/status_${Date.now()}.json`
     ).catch((e) => console.warn('[GCS] Failed to save session log:', e.message));
  }
}
