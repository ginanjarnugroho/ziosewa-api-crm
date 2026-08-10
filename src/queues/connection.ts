import IORedis from 'ioredis';

// Shared Redis connection for BullMQ
export const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null, // Required by BullMQ
});
