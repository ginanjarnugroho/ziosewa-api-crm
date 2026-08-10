import Fastify from 'fastify';
import fs from 'fs';
import path from 'path';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import scalar from '@scalar/fastify-api-reference';
import { Server as SocketIOServer } from 'socket.io';
import multipart from '@fastify/multipart';
import { prisma } from './repositories/prisma';
import { authMiddleware } from './middlewares/authMiddleware';
import deviceController from './controllers/deviceController';
import messageController from './controllers/messageController';
import chatController from './controllers/chatController';
import contactController from './controllers/contactController';
import tenantController from './controllers/tenantController';
import wahaWebhookController from './controllers/wahaWebhookController';
import webhookCatchController from './controllers/webhookCatchController';
import automationRuleController from './controllers/automationRuleController';
import outboxController from './controllers/outboxController';
import { startAutomationScheduler } from './queues/automationWorker';
import './queues/mediaDownloadWorker'; // Initialize background media downloader

const server = Fastify({
  logger: true,
  disableRequestLogging: true
});

// Initialize Socket.io
export const io = new SocketIOServer(server.server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS']
  }
});

io.on('connection', (socket) => {
  server.log.debug(`WebSocket client connected: ${socket.id}`);
  
  // FE will emit 'subscribe_tenant' to listen to specific tenant events
  socket.on('subscribe_tenant', (tenantId: string) => {
    socket.join(`tenant_${tenantId}`);
    server.log.debug(`Socket ${socket.id} joined tenant_${tenantId}`);
  });

  socket.on('disconnect', () => {
    server.log.debug(`WebSocket client disconnected: ${socket.id}`);
  });
});

server.register(cors, {
  origin: '*', // Allow all origins for testing
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
});

// Register Multipart for File Uploads
server.register(multipart, {
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Register Authentication Middleware
server.addHook('preHandler', authMiddleware);

// Read developer guide for API Documentation
const devGuidePath = path.join(process.cwd(), 'docs', 'developer_guide.md');
const devGuideContent = fs.existsSync(devGuidePath) ? fs.readFileSync(devGuidePath, 'utf-8') : 'API Documentation for the Omnichannel Messaging Engine';

server.register(swagger, {
  swagger: {
    info: {
      title: 'Antigravity Messaging SaaS API',
      description: devGuideContent,
      version: '1.0.0'
    },
    securityDefinitions: {
      bearerAuth: {
        type: 'apiKey',
        name: 'Authorization',
        in: 'header',
        description: 'Enter the token with the `Bearer ` prefix, e.g. "Bearer abcde12345"'
      }
    }
  }
});

server.register(scalar, {
  routePrefix: '/docs',
  configuration: {
    theme: 'deepSpace',
    metaData: {
      title: 'Ziosewa CRM API'
    }
  }
});

// Basic Health Check Endpoint
server.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Register Controllers
server.register(deviceController);
server.register(messageController);
server.register(chatController);
server.register(contactController);
server.register(tenantController);
server.register(wahaWebhookController);
server.register(webhookCatchController);
server.register(automationRuleController);
server.register(outboxController);

// Graceful shutdown helper
const closeListeners = ['SIGINT', 'SIGTERM'];
closeListeners.forEach((signal) => {
  process.on(signal, async () => {
    server.log.info(`Received ${signal}, shutting down gracefully...`);
    await server.close();
    await prisma.$disconnect();
    process.exit(0);
  });
});

import { AdapterFactory } from './services/AdapterFactory';

const start = async () => {
  try {
    // Attempt database connection
    await prisma.$connect();
    server.log.debug('Connected to PostgreSQL database');

    // Auto-fix historical synced messages stuck on 'sent'
    try {
      const fixed = await prisma.chatMessage.updateMany({
        where: {
          isFromMe: true,
          status: 'sent',
          createdAt: { lt: new Date(Date.now() - 30 * 1000) } // messages older than 30s
        },
        data: { status: 'read' }
      });
      if (fixed.count > 0) {
        console.log(`[Auto-Fix] Updated ${fixed.count} historical synced messages to 'read' status.`);
      }

      // Reset 'none' profile picture cache so WAHA can retry fetching real avatars
      await prisma.contact.updateMany({
        where: { profilePic: 'none' },
        data: { profilePic: null }
      });

      // Auto-merge duplicate @s.whatsapp.net & WhatsApp @lid IDs to @c.us in database
      try {
        await prisma.$executeRaw`UPDATE chat_messages SET remote_jid = REPLACE(remote_jid, '@s.whatsapp.net', '@c.us') WHERE remote_jid LIKE '%@s.whatsapp.net'`;
        await prisma.$executeRaw`UPDATE contacts SET remote_jid = REPLACE(remote_jid, '@s.whatsapp.net', '@c.us') WHERE remote_jid LIKE '%@s.whatsapp.net'`;
        
        // Merge WhatsApp @lid masked ID (32968219349079) to real phone number (6281360403365@c.us)
        await prisma.$executeRaw`UPDATE chat_messages SET remote_jid = '6281360403365@c.us' WHERE remote_jid LIKE '%32968219349079%'`;
        await prisma.$executeRaw`DELETE FROM contacts WHERE remote_jid LIKE '%32968219349079%'`;
        console.log('[Auto-Fix] Successfully merged @s.whatsapp.net & @lid JIDs to real phone number format.');
      } catch (e) {
        console.error('[JID Auto-Merge Error]', e);
      }

      // Auto-create missing Automation tables DDL
      try {
        await prisma.$executeRawUnsafe(`
          DO $$ BEGIN
              CREATE TYPE "TriggerType" AS ENUM ('EVENT_STATUS_CHANGED', 'TIME_DUE_COUNTDOWN', 'TIME_OVERDUE');
          EXCEPTION WHEN duplicate_object THEN null; END $$;

          DO $$ BEGIN
              CREATE TYPE "OffsetUnit" AS ENUM ('MINUTES', 'HOURS', 'DAYS');
          EXCEPTION WHEN duplicate_object THEN null; END $$;

          DO $$ BEGIN
              CREATE TYPE "OffsetDirection" AS ENUM ('IMMEDIATE', 'BEFORE', 'AFTER');
          EXCEPTION WHEN duplicate_object THEN null; END $$;

          DO $$ BEGIN
              CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');
          EXCEPTION WHEN duplicate_object THEN null; END $$;

          CREATE TABLE IF NOT EXISTS "message_templates" (
              "id" UUID NOT NULL DEFAULT gen_random_uuid(),
              "tenant_id" UUID NOT NULL,
              "name" VARCHAR NOT NULL,
              "template_text" TEXT NOT NULL,
              "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
              CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id"),
              CONSTRAINT "message_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
          );

          CREATE TABLE IF NOT EXISTS "automation_rules" (
              "id" UUID NOT NULL DEFAULT gen_random_uuid(),
              "tenant_id" UUID NOT NULL,
              "name" VARCHAR NOT NULL,
              "trigger_type" "TriggerType" NOT NULL,
              "target_status" VARCHAR NOT NULL DEFAULT 'ANY',
              "offset_value" INTEGER NOT NULL DEFAULT 0,
              "offset_unit" "OffsetUnit" NOT NULL DEFAULT 'HOURS',
              "offset_direction" "OffsetDirection" NOT NULL DEFAULT 'IMMEDIATE',
              "quiet_hours_start" VARCHAR DEFAULT '20:00',
              "quiet_hours_end" VARCHAR DEFAULT '08:00',
              "template_id" UUID NOT NULL,
              "is_enabled" BOOLEAN NOT NULL DEFAULT true,
              "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
              CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id"),
              CONSTRAINT "automation_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
              CONSTRAINT "automation_rules_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "message_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE
          );

          CREATE TABLE IF NOT EXISTS "scheduled_notifications" (
              "id" UUID NOT NULL DEFAULT gen_random_uuid(),
              "tenant_id" UUID NOT NULL,
              "device_id" UUID,
              "rule_id" UUID,
              "order_id" VARCHAR,
              "recipient" VARCHAR NOT NULL,
              "event_key" VARCHAR NOT NULL,
              "rendered_text" TEXT NOT NULL,
              "scheduled_at" TIMESTAMP(3) NOT NULL,
              "sent_at" TIMESTAMP(3),
              "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
              "retry_count" INTEGER NOT NULL DEFAULT 0,
              "last_error" TEXT,
              "metadata" JSONB,
              "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
              CONSTRAINT "scheduled_notifications_pkey" PRIMARY KEY ("id"),
              CONSTRAINT "scheduled_notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
          );

          CREATE INDEX IF NOT EXISTS "scheduled_notifications_status_scheduled_at_idx" ON "scheduled_notifications"("status", "scheduled_at");
          CREATE INDEX IF NOT EXISTS "scheduled_notifications_order_id_idx" ON "scheduled_notifications"("order_id");
        `);
        console.log('[Auto-Fix] Successfully verified / created automation database tables.');
      } catch (e) {
        console.error('[Automation Tables DDL Error]', e);
      }

      // Auto-seed default templates and rules if empty
      try {
        const count = await prisma.messageTemplate.count();
        if (count === 0) {
          const tenant = await prisma.tenant.findFirst();
          if (tenant) {
            const defaultTemplates = [
              {
                name: 'Nota Sewa Baru (Order Created)',
                templateText: 'Halo *{nama_pelanggan}*, terima kasih telah menyewa di *{alamat_toko}*.\n\nBerikut nota pesanan Anda:\n📦 Barang: *{nama_barang}*\n📅 Batas Pengembalian: *{jam_kembali}*\n💰 Total Sewa: *{total_bayar}*\n💳 Sisa Tagihan: *{sisa_tagihan}*\n\nHarap menjaga barang sewa dengan baik. Terima kasih!',
                ruleName: 'Zap: Send Receipt on Order Created',
                triggerType: 'EVENT_STATUS_CHANGED' as const,
                targetStatus: 'ORDER_CREATED',
                offsetValue: 0,
                offsetUnit: 'MINUTES' as const,
                offsetDirection: 'IMMEDIATE' as const
              },
              {
                name: 'Sedang Disiapkan (Preparing)',
                templateText: 'Halo *{nama_pelanggan}*, tim kami sedang menyiapkan & menguji kelengkapan *{nama_barang}* Anda.\n\nKami akan mengabari Anda begitu barang siap diambil!',
                ruleName: 'Zap: Notify when Item is Preparing',
                triggerType: 'EVENT_STATUS_CHANGED' as const,
                targetStatus: 'PREPARING',
                offsetValue: 0,
                offsetUnit: 'MINUTES' as const,
                offsetDirection: 'IMMEDIATE' as const
              },
              {
                name: 'Siap Diambil (Ready for Pickup)',
                templateText: 'Halo *{nama_pelanggan}*, barang sewaan Anda *{nama_barang}* sudah *SIAP DIAMBIL* di *{alamat_toko}*.\n\nSilakan tunjukkan pesan ini ke staf toko kami. Terima kasih!',
                ruleName: 'Zap: Notify when Ready for Pickup',
                triggerType: 'EVENT_STATUS_CHANGED' as const,
                targetStatus: 'READY_FOR_PICKUP',
                offsetValue: 0,
                offsetUnit: 'MINUTES' as const,
                offsetDirection: 'IMMEDIATE' as const
              },
              {
                name: 'Pengingat H-2 Jam (Due Reminder)',
                templateText: '⏰ *PENGINGAT PENGEMBALIAN BARANG*\n\nHalo *{nama_pelanggan}*, mengingatkan bahwa batas waktu pengembalian *{nama_barang}* adalah hari ini jam *{jam_kembali}* di *{alamat_toko}*.\n\nMohon mengembalikan tepat waktu untuk menghindari denda keterlambatan.',
                ruleName: 'Zap: Remind 2 Hours Before Due Time',
                triggerType: 'TIME_DUE_COUNTDOWN' as const,
                targetStatus: 'ANY',
                offsetValue: 2,
                offsetUnit: 'HOURS' as const,
                offsetDirection: 'BEFORE' as const
              },
              {
                name: 'Teguran Keterlambatan (Overdue Alert)',
                templateText: '⚠️ *PERINGATAN KETERLAMBATAN PENGEMBALIAN*\n\nHalo *{nama_pelanggan}*, batas waktu pengembalian *{nama_barang}* (*{jam_kembali}*) telah terlewati.\n\nMohon segera mengembalikan barang ke *{alamat_toko}* atau menghubungi kasir toko kami. Terima kasih!',
                ruleName: 'Zap: Alert 1 Hour After Overdue',
                triggerType: 'TIME_OVERDUE' as const,
                targetStatus: 'ANY',
                offsetValue: 1,
                offsetUnit: 'HOURS' as const,
                offsetDirection: 'AFTER' as const
              },
              {
                name: 'Terima Kasih & Ulasan (Returned)',
                templateText: 'Halo *{nama_pelanggan}*, terima kasih telah mengembalikan *{nama_barang}* dalam kondisi baik di *{alamat_toko}*.\n\nSenang berbisnis dengan Anda! Sampai jumpa di persewaan berikutnya. 🙏',
                ruleName: 'Zap: Thank You Note on Item Returned',
                triggerType: 'EVENT_STATUS_CHANGED' as const,
                targetStatus: 'RETURNED',
                offsetValue: 0,
                offsetUnit: 'MINUTES' as const,
                offsetDirection: 'IMMEDIATE' as const
              }
            ];

            for (const item of defaultTemplates) {
              const t = await prisma.messageTemplate.create({
                data: {
                  tenantId: tenant.id,
                  name: item.name,
                  templateText: item.templateText
                }
              });

              await prisma.automationRule.create({
                data: {
                  tenantId: tenant.id,
                  name: item.ruleName,
                  triggerType: item.triggerType,
                  targetStatus: item.targetStatus,
                  offsetValue: item.offsetValue,
                  offsetUnit: item.offsetUnit,
                  offsetDirection: item.offsetDirection,
                  templateId: t.id,
                  isEnabled: true
                }
              });
            }
            console.log('[Auto-Fix] Successfully seeded 6 default automation templates & Zaps.');
          }
        }
      } catch (e) {
        console.error('[Auto-Seed Error]', e);
      }

      // Start background automation scheduler for scheduled WhatsApp notifications
      startAutomationScheduler(30000);
    } catch (e) {
      console.error('[Auto-Fix Error]', e);
    }

    // Auto reconnect devices
    const connectedDevices = await prisma.device.findMany({ where: { status: 'connected' } });
    for (const device of connectedDevices) {
      server.log.info(`Auto-reconnecting device: ${device.id}`);
      try {
        const adapter = AdapterFactory.getAdapter(device.channelType);
        adapter.connect(device.id, {}).catch(e => server.log.error(`Failed to connect device ${device.id}:`, e));
      } catch (err) {
        server.log.error(`Adapter error for device ${device.id}:`, err);
      }
    }

    await server.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
