import { Storage } from '@google-cloud/storage';

async function run() {
  const storage = new Storage({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });
  const bucketName = process.env.GCS_BUCKET;
  if (!bucketName) throw new Error('GCS_BUCKET env var not set');

  console.log(`Making bucket ${bucketName} public...`);
  const bucket = storage.bucket(bucketName);

  try {
    await bucket.iam.setPolicy({
      bindings: [
        {
          role: 'roles/storage.objectViewer',
          members: ['allUsers'],
        },
      ],
    });
    console.log(`Bucket ${bucketName} is now public!`);
  } catch (err: any) {
    console.error('Failed to make bucket public:', err.message);
  }
}

run();
