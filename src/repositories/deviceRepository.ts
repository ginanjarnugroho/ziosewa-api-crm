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
      status, 
      providerConfig: { state: providerState } 
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

/**
 * Mendaftarkan (membuat) perangkat baru di dalam database.
 */
export async function createDevice(data: { tenantId: string, deviceIdentifier: string, channelType: string, status: string }) {
  return prisma.device.create({
    data
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
