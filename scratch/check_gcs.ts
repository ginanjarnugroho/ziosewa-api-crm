import { Storage } from '@google-cloud/storage';
import path from 'path';

require('dotenv').config({ path: path.join(__dirname, '../.env.production') });

async function main() {
  const bucketName = process.env.GCS_BUCKET!;
  const storage = new Storage({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });
  
  const bucket = storage.bucket(bucketName);
  const prefix = 'avatars/fd8a2ba4-8632-40a7-9843-11b5c9e2e1f9/';
  
  console.log(`Checking bucket: ${bucketName} for prefix: ${prefix}`);
  const [files] = await bucket.getFiles({ prefix });
  
  console.log(`Found ${files.length} files:`);
  for (const f of files.slice(0, 5)) {
    console.log(f.name);
  }
}

main().catch(console.error);
