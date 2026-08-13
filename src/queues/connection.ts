import IORedis from 'ioredis';
import { config } from '../config/env';

// Upstash and some clouds require TLS.
// Using rediss:// implies TLS, but we explicitly allow it for upstash.io just in case.
const redisOptions: any = {
  maxRetriesPerRequest: null, // Required by BullMQ
};

if (config.redisUrl.includes('upstash.io') || config.redisUrl.startsWith('rediss://')) {
  redisOptions.tls = { rejectUnauthorized: false };
}

// Shared Redis connection for BullMQ
export const redisConnection = new IORedis(config.redisUrl, redisOptions);
