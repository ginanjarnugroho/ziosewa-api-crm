import { FastifyRequest, FastifyReply } from 'fastify';
import { AdapterFactory } from '../services/AdapterFactory';
import { WahaAdapter } from '../adapters/WahaAdapter';
import { prisma } from '../repositories/prisma';
import { io } from '../server';
import { upsertMessage } from '../repositories/chatMessageRepository';

export default {
  async handleSendText(request: FastifyRequest, reply: FastifyReply) {
    const { deviceId, channelType, payload, logId } = request.body as any;
    try {
      const adapter = AdapterFactory.getAdapter(channelType);
      const response = await adapter.sendText(deviceId, payload);
      
      let messageId = `temp-${Date.now()}`;
      if (response && response.id) {
         messageId = response.id;
      }
      
      if (logId) {
        await prisma.messageLog.update({
          where: { id: logId },
          data: { status: 'sent' }
        });
        const outMsg = await prisma.messageLog.findUnique({ where: { id: logId }});
        if (outMsg) {
          await upsertMessage({
             tenantId: outMsg.tenantId,
             deviceId: outMsg.deviceId,
             remoteJid: payload.to,
             messageId: messageId,
             isFromMe: true,
             text: payload.message || '',
             messageType: 'text',
             mediaUrl: null,
             mediaPath: null,
             replyToMessageId: payload.reply_to || null,
             timestamp: new Date(),
             status: 'sent'
          });
          io.to(`tenant_${outMsg.tenantId}`).emit('message_sent', { tempId: payload.idempotency_key, message: { ...outMsg, messageId } });
        }
      }
      
      return reply.send({ success: true, messageId });
    } catch (error: any) {
      if (logId) {
        await prisma.messageLog.update({
          where: { id: logId },
          data: { status: 'failed',  }
        });
      }
      console.error('[Task Error]', error?.response?.data || error?.message || error);
      return reply.status(200).send({ success: false, error: error?.message || 'Failed' });
    }
  },

  async handleSendMedia(request: FastifyRequest, reply: FastifyReply) {
    const { deviceId, channelType, payload, logId } = request.body as any;
    try {
      const adapter = AdapterFactory.getAdapter(channelType);
      const response = await adapter.sendMedia!(deviceId, payload);
      
      let messageId = `temp-${Date.now()}`;
      if (response && response.id) {
         messageId = response.id;
      }
      
      if (logId) {
        await prisma.messageLog.update({
          where: { id: logId },
          data: { status: 'sent' }
        });
        const outMsg = await prisma.messageLog.findUnique({ where: { id: logId }});
        if (outMsg) {
          await upsertMessage({
             tenantId: outMsg.tenantId,
             deviceId: outMsg.deviceId,
             remoteJid: payload.to,
             messageId: messageId,
             isFromMe: true,
             text: payload.caption || '',
             messageType: 'image', // Assuming image for simplicity, can be document
             mediaUrl: null, // Should ideally extract from payload, but null is fine for outgoing temp
             mediaPath: null,
             replyToMessageId: payload.reply_to || null,
             timestamp: new Date(),
             status: 'sent'
          });
          io.to(`tenant_${outMsg.tenantId}`).emit('message_sent', { tempId: payload.idempotency_key, message: { ...outMsg, messageId } });
        }
      }
      
      return reply.send({ success: true, messageId });
    } catch (error: any) {
      console.error('[Task Error]', error?.response?.data || error?.message || error);
      return reply.status(200).send({ success: false, error: error?.message || 'Failed' });
    }
  },

  async handleSendReaction(request: FastifyRequest, reply: FastifyReply) {
    const { deviceId, channelType, payload } = request.body as any;
    try {
      const adapter = AdapterFactory.getAdapter(channelType);
      await (adapter as any).sendReaction(deviceId, payload);
      return reply.send({ success: true });
    } catch (error: any) {
      console.error('[Task Error]', error?.response?.data || error?.message || error);
      return reply.status(200).send({ success: false, error: error?.message || 'Failed' });
    }
  },

  async handleSyncHistory(request: FastifyRequest, reply: FastifyReply) {
    // Placeholder for sync history logic
    return reply.send({ success: true });
  },

  async handleDownloadMedia(request: FastifyRequest, reply: FastifyReply) {
    // Placeholder for media download logic
    return reply.send({ success: true });
  },

  async handleProcessAutomation(request: FastifyRequest, reply: FastifyReply) {
    const { notificationId, deviceId } = request.body as any;
    try {
      console.log(`[Cloud Tasks Automation] Processing notificationId: ${notificationId}, deviceId: ${deviceId}`);
      if (notificationId) {
        const notif = await prisma.scheduledNotification.findUnique({ where: { id: notificationId } });
        if (!notif || notif.status !== 'PENDING') {
          return reply.send({ success: true, message: 'Notification already processed or cancelled' });
        }

        const activeDevice = deviceId
          ? await prisma.device.findUnique({ where: { id: deviceId } })
          : await prisma.device.findFirst({ where: { status: 'connected' }, orderBy: { updatedAt: 'desc' } });

        if (!activeDevice || activeDevice.status !== 'connected') {
          return reply.status(400).send({ success: false, error: 'No active WhatsApp device available' });
        }

        const wahaAdapter = new WahaAdapter();
        await wahaAdapter.sendMessage(activeDevice.id, notif.recipient, notif.renderedText);

        await prisma.scheduledNotification.update({
          where: { id: notif.id },
          data: { status: 'SENT', sentAt: new Date(), lastError: null }
        });

        console.log(`[Cloud Tasks Automation] Notification ${notif.id} sent successfully via device ${activeDevice.id}`);

        return reply.send({ success: true, message: 'Automation notification sent via Cloud Tasks' });
      }

      return reply.send({ success: true });
    } catch (error: any) {
      console.error('[Cloud Tasks Automation Error]', error?.message || error);
      if (notificationId) {
        await prisma.scheduledNotification.update({
          where: { id: notificationId },
          data: { status: 'FAILED', lastError: error?.message || 'Cloud Tasks dispatch failed' }
        });
      }
      return reply.status(500).send({ success: false, error: error?.message || 'Failed' });
    }
  }
};
