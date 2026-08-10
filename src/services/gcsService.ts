import { Storage } from '@google-cloud/storage';
import axios from 'axios';
import path from 'path';

const bucketName = process.env.GCS_BUCKET!;

// Gunakan credentials dari GOOGLE_APPLICATION_CREDENTIALS env variable
const storage = new Storage({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});
const bucket = storage.bucket(bucketName);

/**
 * Upload Buffer ke Google Cloud Storage
 * @returns URL publik dari file yang di-upload
 */
export async function uploadBuffer(
  buffer: Buffer,
  destPath: string,
  contentType: string = 'application/octet-stream'
): Promise<string> {
  const file = bucket.file(destPath);
  await file.save(buffer, {
    resumable: false,
    metadata: { contentType },
  });

  // Asumsikan bucket di-set menjadi Public (Uniform Bucket-Level Access - allUsers = Storage Object Viewer)
  // Kembalikan URL publik yang bersih dan permanen
  const publicUrl = `https://storage.googleapis.com/${bucketName}/${destPath}`;
  return publicUrl;
}

/**
 * Download gambar dari URL lalu upload ke GCS
 * @returns URL publik GCS
 */
export async function uploadFromUrl(
  sourceUrl: string,
  destPath: string
): Promise<string> {
  const res = await axios.get(sourceUrl, { responseType: 'arraybuffer', timeout: 10000 });
  const buffer = Buffer.from(res.data);
  const contentType: string = (res.headers['content-type'] as string) || 'image/jpeg';
  return uploadBuffer(buffer, destPath, contentType);
}

/**
 * Upload JSON object ke GCS (untuk session logs / status)
 */
export async function uploadJson(
  data: object,
  destPath: string
): Promise<string> {
  const buffer = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
  return uploadBuffer(buffer, destPath, 'application/json');
}

/**
 * Read JSON object from GCS
 */
export async function readJson<T = any>(destPath: string): Promise<T | null> {
  try {
    const file = bucket.file(destPath);
    const [contents] = await file.download();
    return JSON.parse(contents.toString('utf-8'));
  } catch {
    return null;
  }
}

/**
 * Generate a short-lived Signed URL for a given public URL or destination path.
 * This bypasses the need for the bucket to be completely public.
 */
export async function getSignedUrl(publicUrlOrPath: string): Promise<string> {
  let destPath = publicUrlOrPath;
  
  // Strip query string parameters if present (e.g. ?X-Goog-Algorithm=...)
  if (destPath.includes('?')) {
    destPath = destPath.split('?')[0];
  }

  // Strip domain prefix if present
  if (destPath.startsWith('https://storage.googleapis.com/')) {
    destPath = destPath.replace('https://storage.googleapis.com/', '');
  }
  
  // Strip bucketName prefix if present
  if (bucketName && destPath.startsWith(`${bucketName}/`)) {
    destPath = destPath.substring(`${bucketName}/`.length);
  }

  const file = bucket.file(destPath);
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + 60 * 60 * 1000, // 1 hour
  });
  return url;
}

/**
 * Ambil ekstensi file dari URL (strip query params)
 */
export function getExtFromUrl(url: string, fallback = '.jpg'): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname);
    return ext || fallback;
  } catch {
    return fallback;
  }
}
