import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

async function checkWaha() {
  const WAHA_URL = process.env.WAHA_URL || 'https://api-whatsapp-gateway.ziosewa.com';
  const WAHA_API_KEY = process.env.WAHA_API_KEY || 'waha_secret_key';
  
  try {
    const res = await axios.get(`${WAHA_URL}/api/sessions?all=true`, {
      headers: { 'X-Api-Key': WAHA_API_KEY }
    });
    console.log(JSON.stringify(res.data, null, 2));
  } catch(e: any) {
    console.error(e.message);
  }
}
checkWaha();
