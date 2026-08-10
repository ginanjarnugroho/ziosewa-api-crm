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
