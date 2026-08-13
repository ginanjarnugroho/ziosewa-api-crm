import { prisma } from './prisma';

/**
 * Mencatat (logging) setiap pesan yang akan dikirim ke antrean (Queue).
 * Berguna untuk keperluan penelusuran (Audit Trail) status pengiriman, 
 * memastikan tidak ada pesan keluar yang hilang (Drop Message).
 */
export async function createMessageLog(data: {
  tenantId: string;
  deviceId: string;
  channelType: string;
  direction: string;
  recipient: string;
  messageType: string;
  payload: any;
  status: string;
}) {
  return prisma.messageLog.create({
    data
  });
}
