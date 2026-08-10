import axios from 'axios';

async function run() {
  try {
    const url = 'https://api-crm.ziosewa.com/api/v1/contacts/60124010199@c.us/avatar?tenant_id=f1223a5a-0a04-491d-971b-50d5977101a4&device_id=sewapro_wa_1';
    console.log('Fetching:', url);
    
    // Stop following redirects to see the 302
    const res = await axios.get(url, { maxRedirects: 0, validateStatus: null });
    
    console.log('Status:', res.status);
    console.log('Headers:', res.headers);
    if (res.data) console.log('Data:', typeof res.data === 'object' ? JSON.stringify(res.data) : res.data.substring(0, 100));
  } catch (err: any) {
    console.error('Error:', err.message);
  }
}
run();
