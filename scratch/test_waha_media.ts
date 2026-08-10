import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const WAHA_URL = process.env.WAHA_URL || 'http://localhost:3001';
  const WAHA_API_KEY = process.env.WAHA_API_KEY;
  const deviceId = 'sewapro_wa_1';
  const remoteJid = '6281360403365@c.us';

  try {
    const res = await fetch(`${WAHA_URL}/api/${deviceId}/chats/${remoteJid}/messages?limit=20&downloadMedia=true`, {
      headers: {
        'Accept': 'application/json',
        'X-Api-Key': WAHA_API_KEY!
      }
    });
    
    if (!res.ok) {
        console.error("Failed to fetch", await res.text());
        return;
    }
    const data = await res.json();
    const mediaMsgs = data.filter((m: any) => m.hasMedia);
    if (mediaMsgs.length > 0) {
       console.log("Media message found:");
       console.log(JSON.stringify(mediaMsgs[0], null, 2));
    } else {
       console.log("No media messages found in the last 20 messages.");
       console.log(JSON.stringify(data[0], null, 2));
    }
  } catch (err) {
    console.error(err);
  }
}

main();
