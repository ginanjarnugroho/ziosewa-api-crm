import { FastifyInstance } from 'fastify';
import taskController from '../../controllers/taskController';

export default async function taskRoutes(fastify: FastifyInstance) {
  // Routes for Cloud Tasks Webhooks
  fastify.post('/api/v1/internal/tasks/send-text', taskController.handleSendText);
  fastify.post('/api/v1/internal/tasks/send-media', taskController.handleSendMedia);
  fastify.post('/api/v1/internal/tasks/send-reaction', taskController.handleSendReaction);
  fastify.post('/api/v1/internal/tasks/sync-history', taskController.handleSyncHistory);
  fastify.post('/api/v1/internal/tasks/download-media', taskController.handleDownloadMedia);
  fastify.post('/api/v1/internal/tasks/process-automation', taskController.handleProcessAutomation);
}
