import { prisma } from '../src/repositories/prisma';
import axios from 'axios';

const WAHA_URL = process.env.WAHA_URL || 'http://localhost:3001';
const WAHA_API_KEY = process.env.WAHA_API_KEY || 'waha_secret_key';

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Api-Key': WAHA_API_KEY
  };
}

async function run() {
  try {
    const device = await prisma.device.findFirst({ where: { deviceIdentifier: 'sewapro_wa_1' } });
    if (!device) throw new Error('Device not found');
    
    console.log('Device ID:', device.id);
    console.log('Device Identifier:', device.deviceIdentifier);

    // Test the first endpoint
    console.log(`Fetching from: ${WAHA_URL}/api/${device.id}/chats/overview?limit=1000&merge=true`);
    const chatsRes = await axios.get(`${WAHA_URL}/api/${device.id}/chats/overview?limit=1000&merge=true`, {
      headers: getHeaders()
    });
    console.log('Chats fetched:', chatsRes.data?.length);

    if (chatsRes.data?.length > 0) {
      const firstChat = chatsRes.data[0];
      console.log('First chat:', firstChat.id);
      
      console.log(`Fetching messages from: ${WAHA_URL}/api/${device.id}/chats/${encodeURIComponent(firstChat.id)}/messages?limit=1`);
      const msgRes = await axios.get(`${WAHA_URL}/api/${device.id}/chats/${encodeURIComponent(firstChat.id)}/messages?limit=1`, {
        headers: getHeaders()
      });
      console.log('Messages fetched:', msgRes.data?.length);
    }
    
  } catch (err: any) {
    console.error('Error:', err.response?.data || err.message);
  }
}
run();
