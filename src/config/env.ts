

/**
 * Konfigurasi Utama Aplikasi (Centralized Environment Variables)
 * Selalu impor `config` dari file ini jika Anda membutuhkan akses ke .env
 */
export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  
  // WAHA API Config
  wahaUrl: process.env.WAHA_URL || 'http://localhost:3001',
  wahaApiKey: process.env.WAHA_API_KEY || 'waha_secret_key',
  wahaWebhookUrl: process.env.WAHA_WEBHOOK_URL || 'http://host.docker.internal:3000/api/v1/webhooks/waha',
  
  // Redis / Upstash Config
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  
  // Google Cloud Storage Config
  gcsBucket: process.env.GCS_BUCKET || '',
  googleAppCreds: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  
  // Security / Auth Config
  masterApiKey: process.env.MASTER_API_KEY || '',
};
