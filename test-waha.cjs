const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

async function run() {
  try {
    const wahaPayload = {
      session: 'sewapro_wa_1',
      chatId: '6281360403365@c.us',
      file: { 
        url: 'https://storage.googleapis.com/zio-sewa-storage/outbound-media/sewapro_wa_1/media_1786265665619_vedqbm.png',
        mimetype: 'image/png',
        filename: 'favicon.png'
      },
      caption: 'test'
    };
    
    console.log("Sending to:", process.env.WAHA_URL + '/api/sendImage');
    const response = await axios.post(process.env.WAHA_URL + '/api/sendImage', wahaPayload, {
      headers: { 
        'Accept': 'application/json',
        'X-Api-Key': process.env.WAHA_API_KEY
      }
    });
    console.log("Success:", response.data);
  } catch (e) {
    console.log("Error Status:", e.response?.status);
    console.log("Error Data:", e.response?.data);
  }
}
run();
