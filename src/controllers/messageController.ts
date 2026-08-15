import { CloudTasksService } from '../services/CloudTasksService';
import { FastifyInstance } from 'fastify';
import { findDeviceByIdentifier } from '../repositories/deviceRepository';
import { createMessageLog } from '../repositories/messageLogRepository';
import { AdapterFactory } from '../services/AdapterFactory';
import path from 'path';
import { uploadBuffer } from '../services/gcsService';
import { normalizeJid } from '../utils/phoneUtils';

export default async function messageController(fastify: FastifyInstance) {
  fastify.post('/api/v1/messages/send-text', {
    schema: {
      description: 'Send a text message through a connected device',
      tags: ['Messages'],
      body: {
        type: 'object',
        required: ['device_id', 'to', 'message'],
        properties: {
          device_id: { type: 'string' },
          to: { type: 'string', description: 'Phone number with country code (e.g., 62812...)' },
          message: { type: 'string' },
          idempotency_key: { type: 'string' },
          reply_to: { type: 'string' },
          tenant_id: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    // 1. Ambil data payload (pengirim, tujuan, isi pesan) dari request body
    const { device_id, to, message, idempotency_key, reply_to, tenant_id } = request.body as any;
    const toJid = normalizeJid(to);

    // 2. Cari data perangkat (Device) melalui Repository Layer
    const device = await findDeviceByIdentifier(device_id);
    if (!device) return reply.status(404).send({ error: 'Device not found' });

    // 3. Pastikan perangkat (Device) sedang terkoneksi ke server WAHA
    const adapter = AdapterFactory.getAdapter(device.channelType);
    const status = await adapter.getStatus(device.id);
    if (status !== 'connected') {
      return reply.status(400).send({ error: 'Device is not connected' });
    }

    // 4. Catat pesan ini ke dalam Log (MessageLog) sebagai antrean ('queued')
    const log = await createMessageLog({
      tenantId: tenant_id || device.tenantId,
      deviceId: device.id,
      channelType: device.channelType,
      direction: 'outbound',
      recipient: toJid,
      messageType: 'text',
      payload: { message, idempotency_key, reply_to },
      status: 'queued'
    });

    // 5. Masukkan pesan ke dalam Antrean Background (BullMQ / Redis)
    //    agar pengiriman pesan tidak memblokir respon HTTP (Non-blocking)
    const job = await CloudTasksService.enqueueTask('/api/v1/internal/tasks/send-text', {
      deviceId: device.id,
      channelType: device.channelType,
      payload: { to: toJid, message, idempotency_key, reply_to },
      logId: log.id
    });

    return reply.status(202).send({
      status: "success",
      message: "Message successfully enqueued",
      data: {
        queue_id: job,
        estimated_delay_ms: 1500
      }
    });
  });

  fastify.post('/api/v1/messages/send-media', {
    schema: {
      description: 'Send a media message (image/document)',
      tags: ['Messages'],
      security: [{ bearerAuth: [] }],
      consumes: ['multipart/form-data']
    }
  }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ success: false, error: 'No file uploaded' });

    const deviceIdField = data.fields['device_id'] as any;
    const toField = data.fields['to'] as any;
    const captionField = data.fields['caption'] as any;
    const channelField = data.fields['channel_type'] as any;
    const idempotencyKeyField = data.fields['idempotency_key'] as any;
    const replyToField = data.fields['reply_to'] as any;

    const deviceId = deviceIdField?.value;
    const to = toField?.value;
    const caption = captionField?.value || '';
    const channelType = channelField?.value || 'wa_unofficial';
    const idempotencyKey = idempotencyKeyField?.value;
    const reply_to = replyToField?.value;

    if (!deviceId || !to) return reply.status(400).send({ success: false, error: 'Missing device_id or to' });

    try {
      const buffer = await data.toBuffer();
      
      const device = await findDeviceByIdentifier(deviceId);
      if (!device) return reply.status(404).send({ error: 'Device not found' });
      
      if (device.status === 'disconnected') {
        return reply.status(400).send({ error: 'Device is disconnected' });
      }

      // 3. Hasilkan ID Pesan Sementara (Temporary ID)
      // ID ini nantinya akan dicocokkan & diganti oleh Webhook ketika pesan benar-benar terkirim.
      const msgId = `media_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // 4. Upload file yang dikirim pengguna ke Google Cloud Storage (GCS)
      const ext = path.extname(data.filename) || '';
      const gcsPath = `outbound-media/${deviceId}/${msgId}${ext}`;
      
      const gcsUrl = await uploadBuffer(buffer, gcsPath, data.mimetype);

      // 5. Masukkan tugas pengiriman Media ini ke dalam Antrean (Queue)
      const job = await CloudTasksService.enqueueTask('/api/v1/internal/tasks/send-media', {
        tenantId: device.tenantId,
        deviceId: device.id,
        channelType,
        payload: {
          to,
          caption,
          mimetype: data.mimetype,
          filename: data.filename,
          url: gcsUrl,
          idempotency_key: idempotencyKey,
          reply_to
        }
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 }
      });

      return reply.send({
        success: true,
        message: "Media message successfully enqueued",
        data: {
          queue_id: job,
          gcs_url: gcsUrl
        }
      });
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });
}
