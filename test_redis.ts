import IORedis from 'ioredis';

async function testRedis() {
  console.log('Connecting to Redis...');
  
  // Try connecting with a 3-second timeout
  const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000
  });

  redis.on('error', (err) => {
    console.error('Redis error:', err.message);
  });

  try {
    const res = await redis.ping();
    console.log('Redis response:', res);
    console.log('✅ REDIS IS RUNNING FINE!');
  } catch (err: any) {
    console.error('❌ REDIS FAILED TO RESPOND:', err.message);
  }

  process.exit(0);
}

testRedis();
