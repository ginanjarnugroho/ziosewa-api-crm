import { MessagingChannelAdapter, SendMessagePayload } from '../interfaces/MessagingChannelAdapter';
import { prisma } from '../repositories/prisma';
import axios from 'axios';
import { io } from '../server';
import { uploadFromUrl, getExtFromUrl, getSignedUrl } from '../services/gcsService';
import QRCode from 'qrcode';

const WAHA_URL = process.env.WAHA_URL || 'http://localhost:3001';
const WAHA_API_KEY = process.env.WAHA_API_KEY || 'waha_secret_key';

// WAHA (cloud) sends webhooks ke backend kita via Cloudflare Tunnel atau URL publik
// Set WAHA_WEBHOOK_URL di .env ke URL publik backend, contoh: https://api-crm.ziosewa.com/api/v1/webhooks/waha
const WAHA_WEBHOOK_URL = process.env.WAHA_WEBHOOK_URL || 'http://host.docker.internal:3000/api/v1/webhooks/waha';

export class WahaAdapter implements MessagingChannelAdapter {
  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Api-Key': WAHA_API_KEY
    };
  }

  async connect(deviceId: string, deviceIdentifier: string): Promise<void> {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) return;

    try {
      // 1. Check if session already exists
      let existingSession = null;
      try {
        const res = await axios.get(`${WAHA_URL}/api/sessions?all=true`, { headers: this.getHeaders() });
        const sessions = res.data || [];
        existingSession = sessions.find((s: any) => s.name === deviceId);
      } catch (e: any) {
        console.error('WAHA get sessions error:', e.message);
      }

      if (existingSession) {
        const status = existingSession.status;
        console.log(`[WAHA] Existing session status: ${status}`);

        if (status === 'WORKING') {
          // Make sure webhooks are up to date
          try {
            const sessionConfig = {
              name: deviceId,
              config: {
                webhooks: [
                  {
                    url: WAHA_WEBHOOK_URL,
                    events: [
                      "session.status",
                      "message",
                      "message.any",
                      "message.ack"
                    ]
                  }
                ]
              }
            };
            await axios.put(`${WAHA_URL}/api/sessions/${deviceId}`, sessionConfig, { headers: this.getHeaders() });
            console.log(`[WAHA] Updated webhooks for session ${deviceId}`);
          } catch (e: any) {
            console.log(`[WAHA] Failed to update webhooks for existing session ${deviceId}`, e.message);
          }

          io.to(`tenant_${device.tenantId}`).emit('connection_update', { device_id: deviceId, status: 'connected' });
          return;
        }

        if (status === 'SCAN_QR_CODE' || status === 'STARTING') {
          try {
            const qrRes = await axios.get(`${WAHA_URL}/api/${deviceId}/auth/qr?format=raw`, { headers: this.getHeaders() });
            const qrRaw = typeof qrRes.data === 'string' ? qrRes.data : (qrRes.data?.value || qrRes.data?.qr);
            if (qrRaw) {
               const qrBase64 = await QRCode.toDataURL(qrRaw);
               io.to(`tenant_${device.tenantId}`).emit('qr_update', { device_id: deviceId, qr: qrBase64 });
            }
          } catch (e: any) {
            console.log('[WAHA] Failed to fetch existing QR', e.message);
          }
          return;
        }

        // If STOPPED or FAILED, we just need to start the existing session!
        try {
          await axios.post(`${WAHA_URL}/api/sessions/${deviceId}/start`, {}, { headers: this.getHeaders() });
        } catch(e: any) {
          let errData = e.response?.data || e.message;
          if (typeof errData === 'string' && errData.toLowerCase().includes('<html')) {
            errData = `${e.response?.status} ${e.response?.statusText} - HTML Error Page`;
          } else if (typeof errData === 'object') {
            errData = JSON.stringify(errData);
          }
          console.error('[WAHA] Failed to start existing session:', errData);
        }
        return; // Important: do not proceed to create a new session
      }

        // 3. Create and start a fresh session (if it didn't exist)
        await axios.post(`${WAHA_URL}/api/sessions/start`, {
          name: deviceId,
          config: {
            webhooks: [
              {
                url: WAHA_WEBHOOK_URL,
                events: [
                  "session.status",
                  "message",
                  "message.any",
                  "message.ack"
                ]
              }
            ]
          }
        }, { headers: this.getHeaders() });

    } catch (error: any) {
      const errData = error.response?.data || error.message;
      console.error('[WAHA] Failed to start WAHA session:', typeof errData === 'object' ? JSON.stringify(errData) : errData);
    }
  }

  async disconnect(deviceId: string): Promise<void> {
    try {
      await axios.post(`${WAHA_URL}/api/sessions/${deviceId}/logout`, {}, { headers: this.getHeaders() });
    } catch (e: any) {
      const errData = e.response?.data || e.message;
      console.error('[WAHA] Failed to logout WAHA session:', typeof errData === 'object' ? JSON.stringify(errData) : errData);
    }
    await prisma.device.update({
      where: { id: deviceId },
      data: { status: 'disconnected', providerConfig: { state: 'DISCONNECTED' } }
    });
  }

  async sendText(deviceId: string, payload: SendMessagePayload): Promise<any> {
    const res = await axios.post(`${WAHA_URL}/api/sendText`, {
      session: deviceId,
      chatId: payload.to,
      text: payload.message
    }, { headers: this.getHeaders() });
    return res.data;
  }

  async getStatus(deviceId: string): Promise<string> {
    try {
      const res = await axios.get(`${WAHA_URL}/api/sessions?all=true`, { headers: this.getHeaders() });
      const session = res.data.find((s: any) => s.name === deviceId);
      if (session?.status === 'WORKING') return 'connected';
      return 'disconnected';
    } catch (e) {
      return 'disconnected';
    }
  }

  async getProfilePicUrl(deviceId: string, remoteJid: string): Promise<string | null> {
    const session = deviceId;
    const candidates = [
      remoteJid.replace('@s.whatsapp.net', '@c.us'),
      remoteJid.replace('@c.us', '@s.whatsapp.net'),
      remoteJid
    ];

    for (const contactId of new Set(candidates)) {
      try {
        // Use the new path-based endpoint for chat picture
        const res = await axios.get(`${WAHA_URL}/api/${session}/chats/${encodeURIComponent(contactId)}/picture`, {
          headers: this.getHeaders()
        });

        let url: string | null = null;
        if (typeof res.data === 'string') {
          url = res.data;
        } else if (res.data && typeof res.data === 'object') {
          // WAHA may return different key casings (profilePictureURL, profilePictureUrl, etc.)
          url =
            res.data.profilePictureURL ||
            res.data.profilePictureUrl ||
            res.data.profilePictureUrl ||
            res.data.profile_picture ||
            res.data.url ||
            res.data.picture ||
            null;
        }

        if (url) {
          // Upload ke GCS supaya URL lebih stabil dan tidak expired
          try {
            const ext = getExtFromUrl(url);
            const gcsPath = `avatars/${session}/${contactId.replace('@', '_')}${ext}`;
            const gcsUrl = await uploadFromUrl(url, gcsPath);
            console.log(`[GCS] Avatar uploaded for ${contactId}:`, gcsUrl);
            return gcsUrl;
          } catch (gcsErr: any) {
            console.warn(`[GCS WARN] Upload failed for ${contactId}, using WAHA URL:`, gcsErr.message);
            return url; // fallback ke WAHA URL jika GCS gagal
          }
        }
      } catch (e: any) {
        let errorDetail = e.message;
        if (e.response?.data) {
          if (typeof e.response.data === 'string' && e.response.data.toLowerCase().includes('<html')) {
            errorDetail = `${e.response?.status} ${e.response?.statusText} - HTML Error Page`;
          } else {
            errorDetail = typeof e.response.data === 'object' ? JSON.stringify(e.response.data) : e.response.data;
          }
        }
        console.log(`[WAHA WARN] Profile pic error for ${contactId}:`, errorDetail);
      }
    }
    return null;
  }

  async sendMedia(deviceId: string, payload: { to: string, caption?: string, url?: string, mimetype?: string, filename?: string }): Promise<any> {
    if (!payload.url) throw new Error("URL is required to send media via WAHA Adapter");

    // WAHA requires different endpoints based on media type
    let endpointType = 'File';
    if (payload.mimetype?.startsWith('image/')) endpointType = 'Image';
    else if (payload.mimetype?.startsWith('video/')) endpointType = 'Video';
    else if (payload.mimetype?.startsWith('audio/')) endpointType = 'Voice';

    let finalUrl = payload.url;
    if (finalUrl.includes('storage.googleapis.com/zio-sewa-storage')) {
      try {
        finalUrl = await getSignedUrl(finalUrl);
      } catch (e) {
        console.error('[WAHA] Failed to generate signed URL:', e);
      }
    }

    const wahaPayload: any = {
      session: deviceId,
      chatId: payload.to,
      file: { 
        url: finalUrl,
        mimetype: payload.mimetype,
        filename: payload.filename || 'media_file'
      }
    };

    if (payload.caption && endpointType !== 'Voice') {
       wahaPayload.caption = payload.caption;
    }

    try {
      const response = await axios.post(`${WAHA_URL}/api/send${endpointType}`, wahaPayload, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (e: any) {
      let errorDetail = e.message;
      if (e.response?.data) {
        errorDetail = typeof e.response.data === 'object' ? JSON.stringify(e.response.data) : e.response.data;
      }
      console.error(`[WAHA] sendMedia error:`, errorDetail);
      throw new Error(errorDetail);
    }
  }
}
