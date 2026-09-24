import { CloudTasksService } from '../services/CloudTasksService';
import { FastifyInstance } from 'fastify';

import { createDevice, findDeviceByIdentifier, findDevicesByTenant, updateDeviceStatus } from '../repositories/deviceRepository';
import { findFirstTenant } from '../repositories/tenantRepository';
import { AdapterFactory } from '../services/AdapterFactory';

export default async function deviceController(fastify: FastifyInstance) {
  fastify.post('/api/v1/device/connect', {
    schema: {
      description: 'Initialize a new device connection to WhatsApp',
      tags: ['Device'],
      body: {
        type: 'object',
        required: ['device_id'],
        properties: {
          device_id: { type: 'string', description: 'Unique identifier for the device (e.g., store_01)' }
        }
      }
    }
  }, async (request, reply) => {
    const { device_id } = request.body as any;

    // 2. Cek apakah perangkat sudah terdaftar di Database
    let device = await findDeviceByIdentifier(device_id);

    if (!device) {
      return reply.status(400).send({ success: false, error: 'Device not found' });
    }

    // 3. Update status perangkat menjadi 'pairing' jika statusnya 'disconnected'
    if (device.status === 'disconnected') {
      device = await updateDeviceStatus(device.id, 'pairing', 'PAIRING');
    }

    try {
      // 4. Inisiasi Adapter (contoh: waha, baileys, telegram)
      const adapter = AdapterFactory.getAdapter(device.channelType);
      
      // 5. Panggil fungsi koneksi secara asinkron (Asynchronous Connect)
      //    Sistem akan mencoba menghasilkan QR code melalui Webhooks / Event Listener 
      //    yang berjalan di latar belakang (Background Process).
      adapter.connect(device.id, device.deviceIdentifier);

      // 6. Cek konfigurasi untuk melihat apakah QR Code sudah siap disajikan
      const providerConfig = device.providerConfig as any;
      const existingQr = (device.status === 'pairing' && providerConfig && providerConfig.qr) ? providerConfig.qr : null;

      return reply.send({
        success: true,
        message: 'Connection initiated',
        data: {
          status: device.status,
          state: existingQr ? "QR_READY" : "CONNECTING",
          qr: existingQr
        }
      });
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  fastify.post('/api/v1/device/sync', {
    schema: {
      description: 'Trigger background synchronization of historical chats from WAHA',
      tags: ['Devices'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['device_id'],
        properties: {
          device_id: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { device_id } = request.body as any;
    const user = (request as any).user;

    try {
      // 1. Verifikasi Kepemilikan Perangkat
      const device = await findDeviceByIdentifier(device_id, user?.tenantId);
      if (!device) return reply.status(404).send({ success: false, error: 'Device not found' });

      // 2. Serahkan tugas sinkronisasi histori obrolan ke Background Worker (BullMQ)
      //    Karena sinkronisasi membutuhkan waktu lama dan rakus sumber daya (Resource Intensive)
      await CloudTasksService.enqueueTask('/api/v1/internal/tasks/sync-history', {
        deviceId: device.id,
        tenantId: device.tenantId,
        deviceIdentifier: device.deviceIdentifier
      });

      return reply.send({ success: true, message: 'Sinkronisasi riwayat obrolan telah dimulai di background.' });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  fastify.post('/api/v1/device/disconnect', {
    schema: {
      description: 'Disconnect and logout a device',
      tags: ['Device'],
      body: {
        type: 'object',
        required: ['device_id', 'channel_type'],
        properties: {
          device_id: { type: 'string' },
          channel_type: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { device_id, channel_type } = request.body as any;

    // 1. Verifikasi Eksistensi Perangkat
    const device = await findDeviceByIdentifier(device_id);
    if (!device) return reply.status(404).send({ error: "Device not found" });

    // 2. Putus Sesi di Database: Ubah status menjadi 'disconnected' 
    //    agar antarmuka pengguna (UI) segera menutup layar chat
    await updateDeviceStatus(device.id, 'disconnected', 'DISCONNECTED');

    // 3. Putus Sesi dari sisi Adapter (WAHA / Provider lain)
    const adapter = AdapterFactory.getAdapter(channel_type);
    if (adapter.disconnect) {
      try {
        await adapter.disconnect(device.id);
      } catch (e) {
        console.warn('Socket already closed or failed to logout cleanly:', e);
      }
    }

    return reply.send({ status: 'success', message: 'Device disconnected and session cleared' });
  });

  const createDeviceSchema = {
    description: 'Create and register a new device',
    tags: ['Devices', 'Device'],
    security: [{ bearerAuth: [] }],
    body: {
      type: 'object',
      required: ['device_id', 'channel_type'],
      properties: {
        device_id: { type: 'string', description: 'Unique identifier for the device (e.g., store_01)' },
        channel_type: { type: 'string', enum: ['wa_unofficial', 'wa_cloud', 'telegram', 'line'], description: 'Channel type' },
        tenant_id: { type: 'string', description: 'Tenant ID (optional if authenticated via Bearer token)' },
        auto_connect: { type: 'boolean', description: 'If true, initiates connection to adapter immediately', default: false }
      }
    }
  };

  const handleCreateDevice = async (request: any, reply: any) => {
    try {
      const body = request.body || {};
      const deviceId = body.device_id;
      const channelType = body.channel_type;
      const tenant = request.tenant || (body.tenant_id ? { id: body.tenant_id } : await findFirstTenant());

      const tenantId = tenant?.id;
      if (!tenantId) {
        return reply.status(400).send({ success: false, error: 'tenant_id is required' });
      }

      if (!deviceId) {
        return reply.status(400).send({ success: false, error: 'device_id is required' });
      }

      if (!channelType) {
        return reply.status(400).send({ success: false, error: 'channel_type is required' });
      }

      // Check if device already exists for this tenant
      const existing = await findDeviceByIdentifier(deviceId, tenantId);
      if (existing) {
        return reply.status(409).send({
          success: false,
          error: `Device with identifier '${deviceId}' already exists for this tenant`,
          data: existing
        });
      }

      const status = body.auto_connect ? 'pairing' : 'disconnected';

      const device = await createDevice({
        tenantId,
        deviceIdentifier: deviceId,
        channelType,
        status
      });

      if (body.auto_connect) {
        try {
          const adapter = AdapterFactory.getAdapter(channelType);
          adapter.connect(device.id, device.deviceIdentifier);
        } catch (err: any) {
          request.log.warn({ err }, `Failed to auto-connect device ${device.id}`);
        }
      }

      return reply.status(201).send({
        success: true,
        message: 'Device created successfully',
        data: device
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  };

  // POST create device
  fastify.post('/api/v1/devices', { schema: createDeviceSchema }, handleCreateDevice);

  // GET all devices for tenant
  fastify.get('/api/v1/devices', {
    schema: {
      description: 'Get all devices for tenant',
      tags: ['Devices', 'Device'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request, reply) => {
    try {
      const tenant = (request as any).tenant || await findFirstTenant();
      const devices = await findDevicesByTenant(tenant?.id);
      return { success: true, data: devices };
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}
