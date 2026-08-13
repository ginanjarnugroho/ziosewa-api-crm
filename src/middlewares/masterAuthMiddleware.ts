import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/env';

export async function masterAuthMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ success: false, error: 'Missing or invalid Authorization Bearer token' });
  }

  const apiKey = authHeader.split(' ')[1];
  const masterKey = config.masterApiKey;

  if (!masterKey) {
    return reply.status(500).send({ success: false, error: 'MASTER_API_KEY is not configured on the server' });
  }

  if (apiKey !== masterKey) {
    return reply.status(403).send({ success: false, error: 'Invalid Master API Key' });
  }
}
