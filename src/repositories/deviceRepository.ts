import { prisma } from './prisma';

/**
 * Mengambil data perangkat (device) berdasarkan ID unik internal (UUID).
 */
export async function getDeviceById(id: string) {
  return prisma.device.findUnique({
    where: { id }
  });
}

/**
 * Memperbarui status koneksi sebuah perangkat.
 * Ini biasanya dipanggil saat WebSocket terputus atau terhubung kembali.
 */
export async function updateDeviceStatus(id: string, status: string, providerState: string) {
  return prisma.device.update({
    where: { id },
    data: { 
      status: status as any, 
      providerConfig: { state: providerState } 
    }
  });
}

/**
 * Memperbarui status koneksi sebuah perangkat beserta data kontak/akun (remoteJid, pushName).
 */
export async function updateDeviceStatusAndContact(
  id: string,
  status: string,
  providerState: string,
  remoteJid?: string,
  pushName?: string
) {
  return prisma.device.update({
    where: { id },
    data: {
      status: status as any,
      providerConfig: { state: providerState },
      ...(remoteJid !== undefined ? { remoteJid } : {}),
      ...(pushName !== undefined ? { pushName } : {})
    }
  });
}

/**
 * Mengambil data perangkat berdasarkan "Device Identifier" (seperti 'store_01').
 * Secara opsional dapat di-filter berdasarkan Tenant ID agar lebih aman.
 */
export async function findDeviceByIdentifier(deviceIdentifier: string, tenantId?: string) {
  return prisma.device.findFirst({
    where: { 
      deviceIdentifier, 
      ...(tenantId ? { tenantId } : {}) 
    }
  });
}

export async function createDevice(data: {
  tenantId: string;
  deviceIdentifier: string;
  channelType: string;
  status?: string;
  providerConfig?: any;
  remoteJid?: string;
  pushName?: string;
}) {
  return prisma.device.create({
    data: {
      tenantId: data.tenantId,
      deviceIdentifier: data.deviceIdentifier,
      channelType: data.channelType as any,
      status: (data.status as any) || 'pairing',
      ...(data.providerConfig !== undefined ? { providerConfig: data.providerConfig } : {}),
      ...(data.remoteJid !== undefined ? { remoteJid: data.remoteJid } : {}),
      ...(data.pushName !== undefined ? { pushName: data.pushName } : {})
    }
  });
}

/**
 * Menarik daftar semua perangkat yang dimiliki oleh sebuah Tenant,
 * diurutkan berdasarkan waktu pembaruan terakhir.
 */
export async function findDevicesByTenant(tenantId?: string) {
  return prisma.device.findMany({
    where: tenantId ? { tenantId } : undefined,
    orderBy: { updatedAt: 'desc' }
  });
}
