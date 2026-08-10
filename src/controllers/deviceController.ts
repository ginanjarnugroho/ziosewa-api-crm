import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { prisma } from '../repositories/prisma';
import { AdapterFactory } from '../services/AdapterFactory';
import { syncQueue } from '../queues/syncWorker';

export default async function deviceController(fastify: FastifyInstance) {
  fastify.post('/api/v1/device/connect', {
    schema: {
      description: 'Initialize a new device connection to WhatsApp',
      tags: ['Device'],
      body: {
        type: 'object',
        required: ['device_id', 'channel_type'],
        properties: {
          device_id: { type: 'string', description: 'Unique identifier for the device (e.g., store_01)' },
          channel_type: { type: 'string', enum: ['wa_unofficial', 'wa_cloud', 'telegram'] },
          connection_method: { type: 'string' },
          phone_number: { type: 'string' },
          tenant_id: { type: 'string', description: 'Required for new devices' }
        }
      }
    }
  }, async (request, reply) => {
    const { device_id, channel_type, connection_method, phone_number, tenant_id } = request.body as any;

    let device = await prisma.device.findFirst({ where: { deviceIdentifier: device_id } });

    if (!device) {
      if (!tenant_id) {
        return reply.status(400).send({ error: "tenant_id is required for new devices" });
      }
      device = await prisma.device.create({
        data: {
          tenantId: tenant_id,
          deviceIdentifier: device_id,
          channelType: channel_type,
          status: 'pairing',
        }
      });
    }

    if (device && device.status === 'disconnected') {
      // Force clean up old corrupted/partial sessions before reconnecting

    }

    try {
      const adapter = AdapterFactory.getAdapter(channel_type);
      
      // Async connect call. QR code will be generated via events and stored in DB.
      adapter.connect(device.id, device.deviceIdentifier);

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
    // Extract tenantId from token (assuming req.user exists from authMiddleware)
    const user = (request as any).user;

    try {
      const device = await prisma.device.findFirst({ 
        where: { deviceIdentifier: device_id, tenantId: user?.tenantId } 
      });
      if (!device) return reply.status(404).send({ success: false, error: 'Device not found' });

      await syncQueue.add('syncDeviceHistory', {
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

    const device = await prisma.device.findFirst({ where: { deviceIdentifier: device_id } });
    if (!device) return reply.status(404).send({ error: "Device not found" });

    // 1. Update Database
    await prisma.device.update({
      where: { id: device.id },
      data: { status: 'disconnected', providerConfig: { state: 'DISCONNECTED' } }
    });

    // 2. Disconnect Socket
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
}
