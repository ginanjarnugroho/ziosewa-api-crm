const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

async function run() {
  try {
    const form = new FormData();
    form.append('device_id', 'sewapro_wa_1');
    form.append('to', '6281234567890@c.us');
    form.append('channel_type', 'wa_unofficial');
    // dummy file
    fs.writeFileSync('dummy.jpg', 'fake image content');
    form.append('file', fs.createReadStream('dummy.jpg'));
    
    const res = await axios.post('http://localhost:3000/api/v1/messages/send-media', form, {
      headers: form.getHeaders()
    });
    console.log(res.data);
  } catch (e) {
    console.error('Error:', e.response?.data || e.message);
  }
}
run();
