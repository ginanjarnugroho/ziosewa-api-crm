import { getSignedUrl } from './src/services/gcsService';
async function main() {
  const url = await getSignedUrl('https://storage.googleapis.com/zio-sewa-storage/outbound-media/sewapro_wa_1/media_1786287760839_bkm1za.png');
  console.log("SIGNED URL:");
  console.log(url);
}
main();
