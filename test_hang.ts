import { AdapterFactory } from './src/services/AdapterFactory';
import { prisma } from './src/repositories/prisma';
import { messageQueue } from './src/queues/messageWorker';

async function testSend() {
  console.log('1. Finding device...');
  const device = await prisma.device.findFirst();
  if (!device) {
    console.log('No device found.');
    process.exit(1);
  }
  console.log(`Found device: ${device.id}`);

  console.log('2. Checking status via WAHA...');
  const adapter = AdapterFactory.getAdapter(device.channelType);
  
  // Timeout for the WAHA call to see if it hangs
  const statusPromise = adapter.getStatus(device.id);
  const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 5000));
  
  const status = await Promise.race([statusPromise, timeoutPromise]);
  console.log(`Status result: ${status}`);

  if (status === 'TIMEOUT') {
    console.log('WAHA API call hung!');
    process.exit(1);
  }

  console.log('3. Testing BullMQ / Redis...');
  try {
    const jobPromise = messageQueue.add('test', { test: true });
    const jobTimeout = new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 5000));
    const job = await Promise.race([jobPromise, jobTimeout]);
    
    if (job === 'TIMEOUT') {
      console.log('BullMQ / Redis is hanging!');
    } else {
      console.log('BullMQ job added successfully!');
    }
  } catch (e: any) {
    console.error('BullMQ error:', e.message);
  }

  process.exit(0);
}

testSend();
