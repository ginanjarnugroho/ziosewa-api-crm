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
import { bootstrapDatabase } from './utils/bootstrap';
import { config } from './config/env';

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

    await bootstrapDatabase();

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

    await server.listen({ port: config.port, host: '0.0.0.0' });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
